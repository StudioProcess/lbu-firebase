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
// file:     File (https://developer.mozilla.org/en-US/docs/Web/API/File) 
// code:     eg. '0_0_0_0_0_0'
// message:  String (optional)
// progress: callback function
// Returns:  Promise
// Errors:   
export async function upload(opts) {
  const defaults = {
    file: '',
    message: '',
    code: '',
    progress: null,
  };
  opts = Object.assign({}, defaults, opts);
  
  // Check file
  if ( !opts.file ) {
    throw { message:'No file provided', name:'MissingFile' }
  }
  if ( typeof opts.file != 'object' || !(opts.file instanceof File) ) {
    throw { message:'Invalid file parameter', name:'InvalidFileParameter' };
  }
  if ( !['image/png', 'image/jpeg', 'image/webp'].includes(opts.file.type) ) {
    throw { message:'Invalid file type. Please select PNG, JPEG or WEBP', name:'InvalidFileType' };
  }
  
  // Check code
  if ( opts.code == '' ) {
    throw { message:'No code provided', name:'MissingCode' }
  }
  if ( !checkCodeFormat(opts.code) ) { // try converting from icons once
    opts.code = iconsToCode(opts.code)
  }
  if ( !checkCodeFormat(opts.code) ) {
    throw { message:'Invalid code format', name:'InvalidCodeFormat' }
  }
  
  // Request Location
  //  Throws PositionError (https://developer.mozilla.org/en-US/docs/Web/API/PositionError)
  //  code: 1 .. PERMISSION_DENIED, 2 .. POSITION_UNAVAILABLE, 3 .. TIMEOUT
  let loc = await getLocation();
  // console.log(loc);
  
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
      throw { message:'Invalid upload code provided', name:'InvalidCode' }
    }
    throw e;
  }
  
  const storageRef = storage.ref(`${docRef.id}/${request.photoMetadata.name}`);
  const uploadTask = storageRef.put(opts.file);
  if (opts.progress instanceof Function) {
    uploadTask.on(firebase.storage.TaskEvent.STATE_CHANGED, {
      'next': snapshot => opts.progress({
        totalBytes: snapshot.totalBytes,
        bytesTransferred: snapshot.bytesTransferred
      })
    });
  }
  return uploadTask;
}
