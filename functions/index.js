'use strict';

const REGION = 'europe-west1';
const PATH_MAX_POINTS = 200; // maximum points per path. when more arrive, earliest ones are discarded
const FALLBACK_LOCATION_DIST = 0.1; // distance (in angular degrees) when determining location from previous one.

const functions = require('firebase-functions');
const path = require('path');
const admin = require('firebase-admin'); // runs firebase with full (admin) rights
admin.initializeApp();
const db = admin.firestore();
db.settings({ timestampsInSnapshots:true });



/*
 * Resolve upload code to dot number
 */
async function resolveUploadCode(code) {
  const snap = await db.collection('codes').doc(code).get();
  const num = snap.data().number;
  return num;
}



/*
 * Once a new upload is complete, update dot document with it
 * data: { lat, lng, ts }
 */
async function updatePaths(data) {
  const pathsDoc = db.doc('paths/paths');
  const pathsSnap = await pathsDoc.get();
  const pathsData = pathsSnap.data();
  
  const dotIdx = String(data.dotNum).padStart(3, '0');
  let path = pathsData.paths[dotIdx] || [];
  path.push( data.lat, data.lng );
  if (path.length > PATH_MAX_POINTS * 2) {
    path = path.slice(- PATH_MAX_POINTS * 2); // keep last portion of array
  }
  
  return pathsDoc.update({
    [`paths.${dotIdx}`]: path,
    'last_updated_path': dotIdx,
    'last_updated_id': data.id,
  });
}

/*
 * Get a pseudo-random value between min and max.
 */
function rnd(min, max) {
  return min + Math.random() * (max-min);
}

/*
 * Add a randomly generated location to paths as well as upload doc
 * dotNum: number of dot/path
 * uploadDocRef: ref to upload document
 */
async function updatePathsFallback(dotNum, uploadDocRef) {
  const pathsDoc = db.doc('paths/paths');
  const pathsSnap = await pathsDoc.get();
  const pathsData = pathsSnap.data();
  const dotIdx = String(dotNum).padStart(3, '0');
  
  let path = pathsData.paths[dotIdx] || [];
  const loc = { timestamp: new Date() };
  if (path.length > 2) {
    // Random location near last known location
    const dir = Math.random()*2*Math.PI; // random direction
    loc.latitude  = path[path.length-2] + Math.sin(dir) * FALLBACK_LOCATION_DIST;
    loc.longitude = path[path.length-1] + Math.cos(dir) * FALLBACK_LOCATION_DIST;
    loc.accuracy = -1; 
    // Make sure coordinates stay in range (just in case)
    if (loc.latitude < -90) loc.latitude += 180;
    else if (loc.latitude > 90) loc.latitude -= 180;
    if (loc.longitude < -180) loc.longitude += 360;
    else if (loc.longitude > 180) loc.longitude -= 360;
  } else {
    // Completely random location (approx in eurasia)
    loc.latitude  = rnd(21, 71);
    loc.longitude = rnd(-9, 143);
    loc.accuracy = -2;
  }
  
  // Update upload doc as well
  await uploadDocRef.update({ location: loc });

  // Update paths
  path.push( loc.latitude, loc.longitude );
  if (path.length > PATH_MAX_POINTS * 2) {
    path = path.slice(- PATH_MAX_POINTS * 2); // keep last portion of array
  }
  return pathsDoc.update({
    [`paths.${dotIdx}`]: path,
    'last_updated_path': dotIdx,
    'last_updated_id': uploadDocRef.id,
  });
}

/**
 * Function: checkUpload
 * Trigger:  Cloud Storage, object finalize
 * Checks photos uploaded to cloud storage (there needs to be a corresponding doc)
 * then updates the doc with the upload data.
 */
exports.checkUpload = functions.region(REGION).storage.object().onFinalize( async (object, _context) => {
  // const fileBucket = object.bucket; // The Storage bucket that contains the file.
  // const contentType = object.contentType; // File content type.
  // const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.
  
  const filePath = object.name; // File path in the bucket e.g. 'uD6FpMVaX9YbGYt4vuWJ/820_836956720.jpg'
  const id = path.dirname(filePath); // Upload ID e.g. 'uD6FpMVaX9YbGYt4vuWJ'
  
  // Check in Firestore: There needs to be a doc with that id and pending upload
  const ref = db.collection('uploads').doc(id); // DocumentReference
  
  try {
    const snap = await ref.get(); // DocumentSnapshot
    // Check upload status
    if (snap.data().photoUpload !== 'PENDING') throw { code:'NOT_PENDING' };
    // console.log(snap.id, snap.data());
    const dotNum = await resolveUploadCode( snap.data().code );
    
    if (snap.data().location) {
      await updatePaths({
        dotNum,
        lat: snap.data().location.latitude,
        lng: snap.data().location.longitude,
        ts:  snap.data().timestamp.toMillis(),
        id,
      });
    } else {
      // use fallback location
      await updatePathsFallback(dotNum, ref);
    }
    
    return ref.update({
      photoUpload: 'DONE',
      photoURL: object.mediaLink,
      photoId: object.id,
      photoName: object.name,
      dotNum: dotNum
    });

  } catch (err) {
    // Rejects the Promise if the document is not found.
    console.error(err);
    throw err;
  }
});



/**
 * Function: cleanup
 * Trigger:  Cloud HTTPS Request
 * Deletes pending upload docs that are older than a certain time.
 * This is run periodically as a cron job.
 * Called via: https://europe-west1-lets-build-utopia.cloudfunctions.net/cleanup?key=...
 * Note: Needs an environment set by firebase functions:config:set cron.key="..."
 */
const crypto = require('crypto');
const PromisePool = require('es6-promise-pool').PromisePool;
const UPLOAD_TIMEOUT = 3600 * 1000; // [ms]
const MAX_CONCURRENT = 3;

exports.cleanup = functions.region(REGION).https.onRequest((req, res) => {
  const req_key = req.query.key || '';
  const key = (functions.config().cron && functions.config().cron.key) || '';
  
  // console.log("request key:", req_key);
  // console.log("key:", key);
  
  // Exit if the keys don't match.
  if (key.length !== req_key.length || !crypto.timingSafeEqual(Buffer.from(req_key), Buffer.from(key))) {
    console.log('The key provided in the request does not match the key set in the environment. Check that\'', req_key,
        '\' matches the cron.key attribute in `firebase functions:config:get`');
    res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
        'cron.key environment variable.');
    return null;
  }
  
  // Find uploads with photoUpload = PENDING and older than UPLOAD_TIMEOUT
  // Delete found docs (using promise pool)
  const uploads = db.collection('uploads');
  return uploads
  .where('photoUpload', '==', 'PENDING')
  .where('timestamp', '<', new Date(Date.now() - UPLOAD_TIMEOUT))
  .get().then(result => {
    let idsToDelete = result.docs.map(doc => doc.id );
    if (result.size > 0) {
       console.log(`To delete: ${result.size}, IDs: ${idsToDelete}`);
    } else {
      console.log('Nothing to delete');
    }
    const promisePool = new PromisePool(() => {
      let doc = result.docs.pop();
      return doc ? doc.ref.delete() : null;
    }, MAX_CONCURRENT);
    return promisePool.start();
  }).then(() => {
    res.send('Upload cleanup finished');
    return null;
  }).catch(err => {
    console.error(err);
    res.sendStatus(500);
    return null;
  });
});


/**
 * Function: updateCount
 * Trigger:  Cloud Firestore, on write (create, update, delete) to uploads collection
 * Maintains a counter of sucessful uploads (stats/stats/uploadCount).
 */
exports.updateCount = functions.region(REGION).firestore
.document('uploads/{uploadId}')
.onWrite( (change, _context) => {
  let increment = 0;
  let operation = ''; // for debug output only
  if (!change.after.exists) {
    // doc was deleted
    operation = 'delete';
    if (change.before.data().photoUpload === 'DONE') {
      increment = -1;
    }
  } else if (!change.before.exists) {
    // doc was created
    operation = 'create';
    if (change.after.data().photoUpload === 'DONE') {
      increment = 1;
    }
  } else {
    // doc was updated
    operation = 'update';
    const before = change.before.data().photoUpload;
    const after = change.after.data().photoUpload;
    if (before !== 'DONE' && after === 'DONE') { // it's done now
      increment = 1;
    } else if (before === 'DONE' && after !== 'DONE') { // not done anymore
      increment = -1;
    }
  }

  if (increment === 0) {
    console.log(`operation: ${operation}, increment: ${increment}`);
    return null;
  }
  
  return db.doc('stats/stats').update({
    uploadCount: admin.firestore.FieldValue.increment(increment)
  }).then(_res => {
    console.log(`operation: ${operation}, increment: ${increment}`);
    return null;
  }).catch(err => {
    console.error(err);
    return null;
  });
});
