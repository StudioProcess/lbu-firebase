const functions = require('firebase-functions');
const path = require('path');
const admin = require('firebase-admin');
admin.initializeApp();

exports.checkUpload = functions.storage.object().onFinalize( (object, context) => {
  // const fileBucket = object.bucket; // The Storage bucket that contains the file.
  // const contentType = object.contentType; // File content type.
  // const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.
  
  const filePath = object.name; // File path in the bucket e.g. 'uD6FpMVaX9YbGYt4vuWJ/820_836956720.jpg'
  const id = path.dirname(filePath); // Upload ID e.g. 'uD6FpMVaX9YbGYt4vuWJ'
  
  // Check in Firestore: There needs to be a doc with that id and pending upload
  const firestore = admin.firestore();
  firestore.settings({ timestampsInSnapshots:true });
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
