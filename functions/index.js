'use strict';

const functions = require('firebase-functions');
const path = require('path');
const admin = require('firebase-admin');
admin.initializeApp();
const firestore = admin.firestore();
firestore.settings({ timestampsInSnapshots:true });



/*
 * Resolve upload code to dot number
 */
async function resolveUploadCode(code) {
  const snap = await firestore.collection('codes').doc(code).get();
  const num = snap.data().number;
  return num;
}


/**
 * Function: checkUpload
 * Trigger:  Cloud Storage, object finalize
 * Checks photos uploaded to cloud storage (there needs to be a corresponding doc)
 * then updates the doc with the upload data.
 */
exports.checkUpload = functions.storage.object().onFinalize( async (object, _context) => {
  // const fileBucket = object.bucket; // The Storage bucket that contains the file.
  // const contentType = object.contentType; // File content type.
  // const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.
  
  const filePath = object.name; // File path in the bucket e.g. 'uD6FpMVaX9YbGYt4vuWJ/820_836956720.jpg'
  const id = path.dirname(filePath); // Upload ID e.g. 'uD6FpMVaX9YbGYt4vuWJ'
  
  // Check in Firestore: There needs to be a doc with that id and pending upload
  const ref = firestore.collection('uploads').doc(id); // DocumentReference
  
  try {
    const snap = await ref.get(); // DocumentSnapshot
    // Check upload status
    if (snap.data().photoUpload !== 'PENDING') throw { code:'NOT_PENDING' };
    console.log(snap.id, snap.data());
    const dotNum = await resolveUploadCode( snap.data().code );
    
    await updateStreams({
      dotNum,
      lat: snap.data().location.coords.latitude,
      lng: snap.data().location.coords.longitude,
      ts:  snap.data().timestamp.toMillis()
    });
    
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


/*
 * Once a new upload is complete, update dot data with it
 */
// const simplify = require('simplify-js');

async function updateStreams(data) {
  const streamsDoc = firestore.collection('_').doc('streams');
  const streamsSnap = await streamsDoc.get();
  const streams = streamsSnap.data();
  
  const dotIdx = String(data.dotNum).padStart(3, '0');
  const integrated = streams.integrated[dotIdx] || [];
  const last = streams.last[dotIdx] || [];
  
  integrated.push( data.lat, data.lng );
  
  const lastCount = 10;
  last.unshift( data.lat, data.lng, data.ts );
  if (last.length > lastCount*3) last.slice(0, lastCount*3);
  
  // streams.integrated[dotIdx] = integrated;
  // streams.last[dotIdx] = last;
  // console.log(JSON.stringify(streams));
  
  return streamsDoc.update({
    [`integrated.${dotIdx}`]: integrated,
    [`last.${dotIdx}`]: last,
  });
}


/**
 * Function: cleanup
 * Trigger:  Cloud HTTPS Request
 * Deletes pending upload docs that are older than a certain time.
 * This is run periodically as a cron job.
 */
const crypto = require('crypto');
const PromisePool = require('es6-promise-pool').PromisePool;
const UPLOAD_TIMEOUT = 3600 * 1000; // [ms]
const MAX_CONCURRENT = 3;

exports.cleanup = functions.https.onRequest((req, res) => {
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
  const uploads = firestore.collection('uploads');
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
 * Maintains a counter of sucessful uploads (_/stats/uploadCount).
 */
exports.updateCount = functions.firestore
  .document('uploads/{uploadId}')
  .onWrite( (change, context) => {
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
    
    const stats = firestore.doc('_/stats');
    return firestore.runTransaction(transaction => {
      return transaction.get(stats).then(doc => {
        if (!doc.exists) {
          throw { code:'STATS_DOC_MISSING' };
        }
        let oldCount = doc.data().uploadCount;
        let newCount = oldCount ? oldCount + increment : increment;
        transaction.update(stats, {uploadCount: newCount});
        return newCount;
      });
    }).then( newCount => {
      console.log(`operation: ${operation}, increment: ${increment}, uploadCount: ${newCount}`);
      return null;
    }).catch( err => {
      console.error(err);
      return null;
    });
  });
