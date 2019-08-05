const digits = {
  0: ['md-heart',   0xf308],
  1: ['ios-moon',   0xf468],
  2: ['md-flower',  0xf2f3],
  3: ['ios-star',   0xf4b3],
  4: ['ios-sunny',  0xf4b7],
  5: ['md-play',    0xf357],
  6: ['md-cloud',   0xf2c9],
  7: ['ios-square', 0xf21a],
  8: ['md-water',   0xf3a7],
  9: ['ios-happy',  0xf192],
};

let db, storage;


// Firebase init
export function init(config) {
  firebase.initializeApp(config);
  console.info(`Firebase SDK ${firebase.SDK_VERSION}`);

  db = firebase.firestore();
  storage = firebase.storage();
}


// Code entry
export function setupCodeEntry(opts) {
  const defaults = {
    code_input: '#code',
    digit_buttons: '#keypad button[data-digit]',
    delete_button: '#keypad button.delete'
  };
  
  opts = Object.assign({}, defaults, opts);
  
  function characterForDigit(d) {
    let cp = digits[d][1];
    return String.fromCodePoint(cp);
  }
  
  const input = document.querySelector(opts.code_input);
  const digitButtons = document.querySelectorAll(opts.digit_buttons);
  const deleteButton = document.querySelector(opts.delete_button);
  
  digitButtons.forEach(el => {
    el.addEventListener('mousedown', e => {
      input.value += characterForDigit(el.dataset.digit);
    });
  });
  
  deleteButton.addEventListener('mousedown', e => {
    input.value = input.value.slice(0, -1);
  });
}

// Pop Counter
export function setupPopCounter(opts) {
  const defaults = {
    selector: '#populationClock',
    interval: 1000,
  };
  opts = Object.assign({}, defaults, opts);
  
  const start = 7714100000;
  const persecond = 2.62;
  const date = new Date('2019-07-05');
  const interval = opts.interval;
  const el = document.querySelector(opts.selector)
  
  setInterval(() => {
    let diff = Math.round( (new Date() - date)/1000 ) + 1;
    let result = Math.round( diff * persecond + start );
    el.textContent = Number(result).toLocaleString('de');
  }, interval);
}


// Live Upload Counter
export function setupUploadCounter(opts) {
  const defaults = {
    selector: '#uploadCount'
  }
  opts = Object.assign({}, defaults, opts);
  
  db.doc('_/stats').onSnapshot(snap => {
    let count = snap.data().uploadCount;
    if (count !== undefined) {
      document.querySelector(opts.selector).textContent = count;
    }
  });
}


export function setupImageSelect(opts) {
  const defaults = {
    input: '#photo',
    image: '#photo-display img'
  }
  opts = Object.assign({}, defaults, opts);
  let input = document.querySelector(opts.input);
  input.addEventListener('change', e => {
    let file = e.target.files[0];
    if ( !file || !file.type.startsWith('image/') ) return;
    let img = document.querySelector(opts.image);
    let reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
  });
}


// Streams data
export function onData(cb) {
  if (cb instanceof Function) {
    db.doc('_/streams').onSnapshot(snap => {
      let streams = snap.data();
      cb(streams);
    });
  };
}



// Convert Ionicon chars to code digits
function digitForChar(ch) {
  for (let e of Object.entries(digits)) {
    let testChar = String.fromCodePoint( e[1][1] );
    if (ch == testChar) { return e[0]; }
  }
  return '';
}

// Convert string of icon characters to code string '0_0_0_0_0_0'
export function iconsToCode(iconString) {
  if (!iconString) return '';
  let code = [];
  for (let ch of iconString) {
    code.push( digitForChar(ch) );
  }
  return code.join('_');
}

// Cursory check of code format: number followed by (underscore number)+
function checkCodeFormat(code) {
  // return /^[0-9_]+$/.test(code);
  return /^[0-9](_[0-9])*$/.test(code);
}

export function geolocationSupported() {
  return 'geolocation' in navigator;
}

// options, see: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
async function getLocation(opts) {
  if (!geolocationSupported()) throw { message:'Geolocation not supported', name:'NoGeolocationSupport' };

  return new Promise( (resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp),
      }),
      err => reject(err),
      opts
    );
  });
}

function getFileMetadata(file) {
  if (!file) return '';
  return {
    lastModified: new Date(file.lastModified),
    name: file.name,
    size: file.size,
    type: file.type,
  };
}

// Handle Upload
// 
// file:       File (https://developer.mozilla.org/en-US/docs/Web/API/File) 
// code:       String eg. '0_0_0_0_0_0', or Ionicon symbols 
// message:    String (optional)
// onProgress: callback function, called with { bytesTransferred, totalBytes }
// onLocation: callback function, called with { latitude, longitude, accuracy, timestamp }
// geolocationOptions: https://developer.mozilla.org/en-US/docs/Web/API/PositionOptions
// Returns:    Promise, resolves with {docRef, storageRef, uploadTaskSnap}
// Errors:
//   { name:'MissingFile',            message:'No file provided' }
//   { name:'InvalidFileParameter',   message:'Invalid file parameter' }
//   { name:'InvalidFileType',        message:'Invalid file type. Please select PNG, JPEG or WEBP' }
//   { name:'InvalidCodeFormat',      message:'Invalid code format' }
//   { name:'GeolocationUnsupported', message:'Geolocation feature unsupported in browser' }
//   { name:'GeolocationDenied',      message:'Geolocation denied by user or browser settings' }
//   { name:'GeolocationUnavailable', message:'Geolocation (temporarily) unavailable' }
//   { name:'GeolocationTimeout',     message:'Geolocation timeout' }
//   { name:'InvalidCode',            message:'Invalid upload code provided' }
//   { name:'UploadError',            message: 'Error while uploading file', errorObject }
export async function upload(opts) {
  const defaults = {
    file: '',
    message: '',
    code: '',
    onProgress: null,
    onLocation: null,
    geolocationOptions: undefined,
  };
  opts = Object.assign({}, defaults, opts);
  
  // Check geolocation browser support
  if (!geolocationSupported()) {
    throw { name:'GeolocationUnsupported', message:'Geolocation feature unsupported in browser' }
  }
  
  // Check file
  if ( !opts.file ) {
    throw { name:'MissingFile', message:'No file provided' }
  }
  if ( typeof opts.file != 'object' || !(opts.file instanceof File) ) {
    throw { name:'InvalidFileParameter', message:'Invalid file parameter' };
  }
  if ( !['image/png', 'image/jpeg', 'image/webp'].includes(opts.file.type) ) {
    throw { name:'InvalidFileType', message:'Invalid file type. Please select PNG, JPEG or WEBP' };
  }
  
  // Check code
  if ( opts.code == '' ) {
    throw { name:'MissingCode', message:'No upload code provided' };
  }
  if ( !checkCodeFormat(opts.code) ) { // try converting from icons once
    opts.code = iconsToCode(opts.code)
  }
  if ( !checkCodeFormat(opts.code) ) {
    throw { name:'InvalidCodeFormat', message:'Invalid code format' };
  }
  
  // Request Location
  let loc;
  try {
    //  Throws PositionError (https://developer.mozilla.org/en-US/docs/Web/API/PositionError)
    //  code: 1 .. PERMISSION_DENIED, 2 .. POSITION_UNAVAILABLE, 3 .. TIMEOUT
    loc = await getLocation(opts.geolocationOptions);
    if (opts.onLocation instanceof Function) {
      opts.onLocation(loc);
    }
    // console.log(loc);
  } catch (e) {
    if (e.code == 1) throw { name:'GeolocationDenied', message:'Geolocation denied by user or browser settings' };
    if (e.code == 2) throw { name:'GeolocationUnavailable', message:'Geolocation (temporarily) unavailable' };
    if (e.code == 3) throw { name:'GeolocationTimeout', message:'Geolocation timeout' };
    throw e;
  }
  
  // Upload Data
  let request = {
    message: opts.message,
    photoMetadata: getFileMetadata(opts.file),
    photoUpload: 'PENDING',
    code: opts.code,
    location: loc,
    clientTimestamp: new Date(),
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  };
  // console.log(request);
  let docRef;
  try {
    docRef = await db.collection('uploads').add(request);
  } catch (e) {
    if (e.code == 'permission-denied') {
      throw { name:'InvalidCode', message:'Invalid upload code provided' };
    }
    throw e;
  }
  
  // Upload File
  const storageRef = storage.ref(`${docRef.id}/${request.photoMetadata.name}`);
  let uploadTaskSnap;
  try {
    const uploadTask = storageRef.put(opts.file);
    if (opts.onProgress instanceof Function) {
      uploadTask.on(firebase.storage.TaskEvent.STATE_CHANGED, {
        'next': snapshot => opts.onProgress({
          totalBytes: snapshot.totalBytes,
          bytesTransferred: snapshot.bytesTransferred
        })
      });
    }
    uploadTaskSnap = await uploadTask;
  } catch (e) {
    throw { name:'UploadError', message: 'Error while uploading file', errorObject:e };
  }
  
  return {
    docRef,
    storageRef,
    uploadTaskSnap
  }
}
