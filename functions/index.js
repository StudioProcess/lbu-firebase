'use strict';

const functions = require('firebase-functions');
const path = require('path');
const admin = require('firebase-admin');
admin.initializeApp();

const firestore = admin.firestore();
firestore.settings({ timestampsInSnapshots:true });


exports.checkUpload = functions.storage.object().onFinalize( (object, context) => {
  // const fileBucket = object.bucket; // The Storage bucket that contains the file.
  // const contentType = object.contentType; // File content type.
  // const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.
  
  const filePath = object.name; // File path in the bucket e.g. 'uD6FpMVaX9YbGYt4vuWJ/820_836956720.jpg'
  const id = path.dirname(filePath); // Upload ID e.g. 'uD6FpMVaX9YbGYt4vuWJ'
  
  // Check in Firestore: There needs to be a doc with that id and pending upload
  const doc = firestore.collection('uploads').doc(id);
  return doc.get().then(doc => {
    // Check upload status
    if (doc.data().photoUpload !== 'PENDING') throw { code:'NOT_PENDING' };
    console.log(doc.id, doc.data());
    return doc.ref.update({
      photoUpload: 'DONE',
      photoURL: object.mediaLink,
      photoId: object.id,
      photoName: object.name
    });
  }).catch(err => {
    // Fails the Promise if the document is not found.
    console.error(err);
  });
});


const crypto = require('crypto');
const PromisePool = require('es6-promise-pool').PromisePool;
const UPLOAD_TIMEOUT = 3600 * 1000;
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
  
  // Find uploads with photoUpload = PENDING and older than a day
  return firestore.collection('uploads')
  .where('photoUpload', '==', 'PENDING')
  .where('timestamp', '<', new Date(Date.now() - UPLOAD_TIMEOUT))
  .get().then(result => {
    // console.log(result.size);
    let data = result.size + '\n' + result.docs.map(doc => doc.id ).join('\n');
    res.status(200).send(data);
    return null;
  }).catch(err => {
    console.error(err);
    return null;
  });
  
  // TODO: delete found docs (using promise pool)
  
  // // Fetch all user details.
  // return getInactiveUsers().then((inactiveUsers) => {
  //   // Use a pool so that we delete maximum `MAX_CONCURRENT` users in parallel.
  //   const promisePool = new PromisePool(() => deleteInactiveUser(inactiveUsers), MAX_CONCURRENT);
  //   return promisePool.start();
  // }).then(() => {
  //   console.log('User cleanup finished');
  //   res.send('User cleanup finished');
  //   return null;
  // });
});
