/*
  Exported functions:
  
  For use in production:
    init(config)
    setupCodeEntry(opts)
    setupPopCounter(opts)
    setupUploadCounter(opts): Promise
    setupImageSelect(opts): Promise
    onData(cb): Promise
    upload(opts): Promise
  
  Sample data:
    loadSampleData(): Promise
    sampleLocation(previousPoint, distance): Promise
    samplePic(width, height): Promise
    uploadCode(dotNum): Promise
    sampleUpload(opts): Promise
    samplePathData(opts): Promise
  
  Reset functions:
    resetPaths(): Promise
    resetUploads(): Promise
*/

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
    el.addEventListener('mousedown', _e => {
      input.value += characterForDigit(el.dataset.digit);
    });
  });
  
  deleteButton.addEventListener('mousedown', _e => {
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
  
  function update() {
    let diff = Math.round( (new Date() - date)/1000 ) + 1;
    let result = Math.round( diff * persecond + start );
    el.textContent = Number(result).toLocaleString('de');
  }
  
  setInterval(update, interval);
  update();
}


// Live Upload Counter
// Returns: Promise, resolves when first count is received
export function setupUploadCounter(opts) {
  const defaults = {
    selector: '#uploadCount'
  }
  opts = Object.assign({}, defaults, opts);
  
  return new Promise((resolve, _reject) => {
    
    db.doc('stats/stats').onSnapshot(snap => {
      let count = snap.data().uploadCount;
      if (count !== undefined) {
        document.querySelector(opts.selector).textContent = count;
        resolve(count);
      }
    });
    
  });
}


// Optional Callback is invoked every time an image is loaded
// Returns: Promise, resolves when first image is loaded
export async function setupImageSelect(opts, cb) {
  const defaults = {
    input: '#photo',
    image: '#photo-display img',
    background: '',
  }
  opts = Object.assign({}, defaults, opts);
  let input = document.querySelector(opts.input);
  
  return new Promise(resolve => {
    input.addEventListener('change', e => {
      let file = e.target.files[0];
      if ( !file || !file.type.startsWith('image/') ) return;
      let reader = new FileReader();
      reader.onload = e => {
        if (opts.background) {
          let img = document.querySelector(opts.background);
          img.style.setProperty('background-image', `url(${e.target.result})`, 'important');
        } else {
          let img = document.querySelector(opts.image);
          img.src = e.target.result;
        }
        resolve(e);
        if (cb instanceof Function) cb(e);
      };
      reader.readAsDataURL(file);
    });
  });
}


// Paths data
// Takes an optional callback that is called each time there is an update
// Returns a promise that resolves with the first data snapshot
// Data structure:
// {
//   integrated: {
//     "000": [lat_0, lng_0, lat_1, lng_1, ...],
//     "001": ...
//      ...
//     "321": ...
//   },
//   last: {
//     "000": [lat_n, lng_n, ts_n, lat_n-1, lng_n-1, ts_n-1, ...],
//     "001": ... 
//      ...
//     "321":
//   }
//   updated: "001"
// }
// NOTES: 
//   "integrated": a simplified path for each dot stream (uses simplify.js). last entry are newest
//   "last": the last n entries with timestamps. first entry is newest
//   "updated": key of last updated stream

export function onData(cb) {
  return new Promise( (resolve, _reject) => {
    db.doc('paths/paths').onSnapshot(snap => {
      let paths = snap.data();
      if (cb instanceof Function) cb(paths);
      resolve(paths);
    });
  });
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
// locationOptions:  https://developer.mozilla.org/en-US/docs/Web/API/PositionOptions
// locationOverride: {latitude, longitude, accuracy, timestamp}
// Returns:    Promise, resolves with {docRef, storageRef, uploadTaskSnap}
// Errors:
//   { name:'MissingFile',            message:'No file provided' }
//   { name:'InvalidFileParameter',   message:'Invalid file parameter' }
//   { name:'InvalidFileType',        message:'Invalid file type. Please select PNG, JPEG or WEBP' }
//   { name:'InvalidFileSize',        message:'File size exeeds upload limit' }
//   { name:'MissingCode',            message:'No upload code provided' }
//   { name:'InvalidCodeFormat',      message:'Invalid code format' }
//   { name:'GeolocationUnsupported', message:'Geolocation feature unsupported in browser' }
//   { name:'GeolocationDenied',      message:'Geolocation denied by user or browser settings' }
//   { name:'GeolocationUnavailable', message:'Geolocation (temporarily) unavailable' }
//   { name:'GeolocationTimeout',     message:'Geolocation timeout' }
//   { name:'InvalidCode',            message:'Invalid upload code provided' }
//   { name:'UploadSize',             message:'Upload size limit exeeded' }
//   { name:'UploadError',            message:'Error while uploading file', errorObject }
const FILE_SIZE_LIMIT = 1024 * 1024 * 10;
export async function upload(opts) {
  const defaults = {
    file: '',
    message: '',
    code: '',
    onProgress: null,
    onLocation: null,
    locationOptions: undefined,
    locationOverride: undefined,
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
  if (opts.file.size > FILE_SIZE_LIMIT * 0.99) {
    throw { name:'InvalidFileSize', message:'File size exeeds upload limit' };
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
  let loc = opts.locationOverride;
  if (!loc) {
    try {
      //  Throws PositionError (https://developer.mozilla.org/en-US/docs/Web/API/PositionError)
      //  code: 1 .. PERMISSION_DENIED, 2 .. POSITION_UNAVAILABLE, 3 .. TIMEOUT
      loc = await getLocation(opts.locationOptions);
      // console.log(loc);
    } catch (e) {
      if (e.code == 1) throw { name:'GeolocationDenied', message:'Geolocation denied by user or browser settings' };
      if (e.code == 2) throw { name:'GeolocationUnavailable', message:'Geolocation (temporarily) unavailable' };
      if (e.code == 3) throw { name:'GeolocationTimeout', message:'Geolocation timeout' };
      throw e;
    }
  }
  if (opts.onLocation instanceof Function) {
    opts.onLocation(loc);
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
    if (e.code_ == 'storage/unauthorized') throw { name:'UploadSize', message:'Upload size limit exeeded' };
    else throw { name:'UploadError', message:'Error while uploading file', errorObject:e };
  }
  
  return {
    docRef,
    storageRef,
    uploadTaskSnap
  }
}



/*
 * Sample Data
*/
const _sampleDataPath = './data/sample_data.json';
let _sampleDataPromise, _sampleData;

// lat: -90 .. +90, lng: -180 .. +179
function getGridCell(lat, lng) {
  // console.log(lat, lng);
  lat += 1; // seems data is indexed like this
  if (lat < -90 || lat > 90) return [];
  lat = Math.floor(lat);
  
  while (lng < -180) lng += 360;
  while (lng > 180) lng -= 360;
  lng = Math.floor(lng);
  
  const key = 'lat' + (lat<0 ? '-' : '+') + String(Math.abs(lat)).padStart(3, '0') 
    + '_lng' + (lng<0 ? '-' : '+') + String(Math.abs(lng)).padStart(3, '0');

  const grid = _sampleData[key];
  return grid;
}


function getGridCellNeighborhood(lat, lng, dist = 1) {
  dist = Math.floor(dist);
  let data = [];
  for ( let j=lat-dist; j<=lat+dist; j++ ) {
    for ( let i=lng-dist; i<=lng+dist; i++ ) {
      data = data.concat( getGridCell(j, i) );
    }
  }
  return data;
}


const KM_PER_DEG = 111;
function dist(p0, p1) {
  return Math.sqrt( Math.pow((p0[0]-p1[0]) * KM_PER_DEG, 2) + Math.pow((p0[1]-p1[1]) * KM_PER_DEG, 2) );
}

export async function loadSampleData() {
  if (!_sampleDataPromise) { // only attempt to load once
    console.log('Loading sample data...');
    _sampleDataPromise = fetch(_sampleDataPath).then( async response => {
      if (!response.ok) throw { message: 'Request failed', responseObject: response };
      _sampleData = await response.json();
      console.log('Sample data loaded');
      return _sampleData;
    }).catch(_err => {
      console.log('Couldn\'t load sample data');
    });
  }
  return _sampleDataPromise;
}

// Check sample data for non-number values
export async function checkSampleData() {
  let sampleData = await loadSampleData();
  let emptyCount = 0;
  let problemCount = 0;
  for (let [key, data] of Object.entries(sampleData)) {
    if (data.length === 0) emptyCount++;
    if (data.length % 2 !== 0) {
      console.warn(`${key}: not a multiple of 2 (${data.length})`);
      problemCount++;
    }
    for (let [idx, val] of data.entries()) {
      if (typeof val !== 'number') {
        console.warn(`${key}, index ${idx}: ${val}`);
        problemCount++;
      }
    }
  }
  let cells = Object.keys(sampleData).length;
  console.log(`cells: ${cells}, empty: ${emptyCount} (${(emptyCount/cells*100).toFixed(0)}%), problems: ${problemCount}`,);
}

export async function sampleLocation(previousPoint, distance = 100) {
  await loadSampleData(); // make sure sample data is loaded
  if (!_sampleData) return; // return undefined if we have no data
  
  if (!previousPoint) {     // get a random point (ignore distance)
    let data;
    while (!data || data.length < 2000) { // find a full grid cell
      data = getGridCell( -90 + Math.random() * 180, -180 + Math.random() * 360 )
    }
    // console.log('found grid', data);
    const idx = Math.floor( Math.random() * data.length / 2 ) * 2;
    // console.log('picking index', idx)
    return data.slice( idx, idx+2 );
  }
  
  // let data = getGridCell(previousPoint[0], previousPoint[1]);
  const data = getGridCellNeighborhood(previousPoint[0], previousPoint[1], distance / KM_PER_DEG);
  if (data.length == 0) {
    throw 'Error getting grid data';
  }

  // sort
  const points = [];
  for (let i=0; i<data.length; i+=2) {
    const point = [ data[i], data[i+1] ];
    point[2] = dist(point, previousPoint); // add distance to previous point as 3rd element
    points.push( point );
  }
  // sort by difference to desired distance
  points.sort( (a,b) => Math.abs(a[2] - distance) - Math.abs(b[2] - distance) );
  // console.log(points);
  // return point that's closest to desired distance
  return points[0];
}

// Generates a Random PNG Picture
// Returns Promise { file:File, dataURL:String }
export async function samplePic(width = 1500, height = 1000) {
  function random(min, max) {
    return Math.floor( min + Math.random() * (max-min) );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i=0; i<3; i++) {
    ctx.fillStyle = `hsl(${random(0,360)},80%,70%)`;
    const size = random(canvas.width/3, canvas.width);
    const left = random(0, canvas.width);
    const top =  random(0, canvas.height);
    if (Math.random() < 0.5) ctx.fillRect(left, top, size, size);
    else {
      ctx.beginPath();
      ctx.ellipse(left, top, size, size, 0, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  
  let blob = await new Promise( resolve => canvas.toBlob(resolve) );
  let timestamp = new Date();
  let name = 'randompic_' + timestamp.toISOString() + '.png';
  let file = new File([blob], name, {type:'image/png', lastModified:timestamp.getTime()});
  return {
    file,
    dataURL: canvas.toDataURL()
  };
}

const _codesPath = './data/codes.json';

export async function uploadCode(dotNum) {
  try {
    const response = await fetch(_codesPath);
    if (!response.ok) throw { message: 'Request failed', responseObject: response };
    const codes = await response.json();
    if (dotNum < 0 || dotNum > codes.length-1) return;
    return codes[dotNum]; 
  } catch (err) {
    console.log('Couldn\'t load upload codes');
    return;
  }
}

// Get a full set of sample upload data compatible with upload()
// Options:
//   dotNum:   Dot for which to generate data. If left undefined (or NaN) a random dot is picked
//   distance: Desired distance from last location of dot
//   latitude/longitude: Provide specific location, overrides distance parameter if given
export async function sampleUpload(opts) {
  const defaults = {
    dotNum: undefined,
    distance: 100,
    latitude: undefined,
    longitude: undefined,
  };
  opts = Object.assign({}, defaults, opts);
  
  if ( opts.dotNum === undefined || isNaN(opts.dotNum) ) {
    opts.dotNum = Math.floor( 1 + Math.random() * 320 );
  }
  
  if ( opts.distance === undefined || isNaN(opts.distance) ) {
    opts.distance = defaults.distance;
  }
  
  const message = "Hello, sample message " + (new Date()).toISOString() + "!";
  const code = await uploadCode(opts.dotNum);
  const codeSymbols = code.split('_').reduce( (acc, num) => acc + String.fromCodePoint(digits[parseInt(num)][1]), '' );
  const photo = await samplePic();
  
  // Determine location
  const loc = { latitude: 0, longitude: 0, accuracy: 0, timestamp: new Date() };
  const snap = await db.doc('paths/paths').get();
  const paths = snap.data().last;
  const dotData = paths[ String(opts.dotNum).padStart(3,'0') ]; 
  const previousLoc = dotData ? dotData.slice(0,2) : null;
  let distance;
  if (opts.latitude !== undefined && opts.longitude !== undefined) { // use given location
    loc.latitude = opts.latitude;
    loc.longitude = opts.longitude;
    if (previousLoc) {
      distance = dist( previousLoc, [opts.latitude, opts.longitude] );
    }
  } else { // determine location based on distance
    const newloc = await sampleLocation( previousLoc, opts.distance );
    loc.latitude = newloc[0];
    loc.longitude = newloc[1];
    distance = newloc[2]; // can be undefined, in case of random location
  }

  return {
    file: photo.file,
    code,
    message,
    locationOverride: loc,
    
    codeSymbols,
    dotNum: opts.dotNum,
    distance,
    dataURL: photo.dataURL
  };
}



// Adds sample data to the specified dot stream
// Returns a new data object
// const SIMPLIFY_TOLERANCE = 0.5; // tolerance setting for simplify.js
// const SIMPLIFY_THRESHOLD = 25;  // simplify only when more than this amount of points
const KEEP_LAST = 10;           // how many points to keep in last array
async function addSamplePath(data, opts) {
  const defaults = {
    dotNum: 0,
    startLatitude: undefined, // if undefined and dot has no previous location, picks a random location
    startLongitude: undefined,
    distanceMin: 50, // distance between steps
    distanceMax: 250,
    steps: 1, // how many points to add
  };
  opts = Object.assign({}, defaults, opts);
  
  data = Object.assign({}, data); // clone data object
  
  // parameter checks and sanitizing 
  if (opts.steps <= 0) return data;
  if (opts.steps == undefined) { opts.steps = defaults.steps; }
  if (opts.distanceMin == undefined || opts.distanceMin <= 0) { opts.distanceMin = defaults.distanceMin; }
  if (opts.distanceMax == undefined || opts.distanceMax <= 0) { opts.distanceMax = defaults.distanceMax; }
  if (opts.distanceMin > opts.distanceMax) {
    let help = opts.distanceMin;
    opts.distanceMin = opts.distanceMax;
    opts.distanceMax = help;
  }
  
  let dotkey = opts.dotNum.toString().padStart(3, '0');
  console.log('ADDING TO STREAM', dotkey, '(' + opts.steps + ' steps)')
  // determine start location (given, from previous, random)
  if ( opts.startLatitude === undefined || opts.startLatitude === null || isNaN(opts.startLatitude) ||
    opts.startLongitude === undefined || opts.startLongitude === null || isNaN(opts.startLongitude)) {
    // check for previous location
    if (data.last && data.last[dotkey] && data.last[dotkey].length >= 3) { // get last location of dot stream
      let last = data.last[dotkey].slice(0, 3);
      let dist = Math.floor( opts.distanceMin + Math.random() * (opts.distanceMax - opts.distanceMin) );
      let loc = await sampleLocation( last, dist );
      opts.startLatitude = loc[0];
      opts.startLongitude = loc[1];
      console.log('  previous location:', last[0], last[1], "start at:", loc[0], loc[1]);
    } else {
      // get a random start location
      let loc = await sampleLocation(); 
      opts.startLatitude  = loc[0];
      opts.startLongitude = loc[1];
      console.log('  start at random location:', loc[0], loc[1]);
    }
  } else {
    console.log('  start at forced location:', opts.startLatitude, opts.startLongitude);
  }
  
  // generate stream of locations
  let locs = [opts.startLatitude, opts.startLongitude];
  if (opts.steps <= 0) opts.steps = 1; 
  for (let i=0; i<opts.steps-1; i++) {
    let dist = Math.floor( opts.distanceMin + Math.random() * (opts.distanceMax - opts.distanceMin) );
    let prevLoc = locs.slice(i*2, i*2+2);
    let loc = await sampleLocation( prevLoc, dist );
    loc = loc.slice(0, 2);
    locs.push(...loc);
  }
  
  // integrated property
  let integrated = data.integrated[dotkey] || [];
  integrated.push(...locs);
  data.integrated[dotkey] = integrated;
  
  // last property
  let last = data.last[dotkey] || [];
  for (let i=0; i<locs.length; i+=2) {
    last.unshift(locs[i], locs[i+1], 0);
  }
  last = last.slice(0, KEEP_LAST*3);
  data.last[dotkey] = last;
  
  // last updated property
  data.updated = dotkey;
  
  return data;
}

// Add sample data to the stream, without going through the normal upload process
// Note: This just adds data to the integrated stream, without simplifying
export async function samplePathData(opts) {
  const defaults = {
    dotNum: undefined, // if undefined, picks a random dot
    startLatitude: undefined, // if undefined and dot has no previous location, picks a random location
    startLongitude: undefined,
    distanceMin: 50, // distance between steps
    distanceMax: 250,
    steps: 1, // how many points to add
  };
  opts = Object.assign({}, defaults, opts);
  if ( opts.dotNum === undefined || opts.dotNum === null || isNaN(opts.dotNum) ) {
    opts.dotNum = Math.floor( 1 + Math.random() * 320 );
  }
  
  let data = (await db.doc('paths/paths').get()).data();
  data = await addSamplePath(data, opts);
  // console.log(data);
  return db.doc('paths/paths').set(data);
}

// Add sample Data to multiple paths simultaneously
export async function samplePathDataMultiple(opts) {
  const defaults = {
    startDot: 1,
    endDot: 10,
    distanceMin: 50, // distance between steps
    distanceMax: 250,
    steps: 1, // how many points to add to each dot stream
    stepChance: 1,
  };
  opts = Object.assign({}, defaults, opts);
  
  if (opts.startDot > opts.endDot) {
    let help = opts.startDot;
    opts.startDot = opts.endDot;
    opts.endDot = help;
  }
  
  if (opts.startDot < 0 || opts.startDot > 321 || opts.endDot < 0 || opts.endDot > 321) {
    console.warn('sampleScatterData: Invalid startDot / endDot parameters');
    return;
  }
  
  let data = (await db.doc('paths/paths').get()).data();
  
  for (let dotNum = opts.startDot; dotNum <= opts.endDot; dotNum++) {
    // how many steps to add to this dot stream 
    let steps = 0;
    for (let i=0; i<opts.steps; i++) { if (Math.random() < opts.stepChance) steps++; }
    // add to dot stream
    data = await addSamplePath(data, {
      dotNum,
      distanceMin: opts.distanceMin,
      distanceMax: opts.distanceMax,
      steps,
    });
  }
  
  // update data
  console.log('setting data', data);
  return db.doc('paths/paths').set(data);
}



/*
 * Reset functions
 * Note: Needs rules enabled in firestore.rules and storage.rules
*/

// Reset paths document to empty state
export async function resetPaths() {
  return db.doc('paths/paths').set({
    integrated: {}, last: {}, updated: ''
  }).then(() => {
    console.log('COMPLETED resetPaths');
  });
}

// Reset uploads (i.e. uploads collection in firestore and images in storage)
export async function resetUploads() {
  // delete uploads collection
  await deleteCollection(db, 'uploads', 100).then(() => {
    console.log('  Note: Deleted uploads collection');
  });
  
  // delete storage
  // needs list and delete permissions (write)
  let result = await storage.ref('/').listAll();
  let folderRefs = result.prefixes;
  
  let filePromises = folderRefs.map(ref => ref.listAll());
  
  result = await Promise.all(filePromises);
  let fileRefs = result.reduce((acc, res) => acc.concat(res.items), []);
  
  let deletePromises = fileRefs.map(ref => ref.delete());
  return Promise.all(deletePromises).then(() => {
    console.log('  Note: Deleted images in storage bucket');
    console.log('COMPLETED resetUploads');
  });
}

// Helper for resetUploads()
async function deleteCollection(db, collectionPath, batchSize) {
  let collectionRef = db.collection(collectionPath);
  let query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, batchSize, resolve, reject);
  });
}

// Helper for deleteCollection()
function deleteQueryBatch(db, query, batchSize, resolve, reject) {
  query.get()
    .then((snapshot) => {
      // When there are no documents left, we are done
      if (snapshot.size == 0) {
        return 0;
      }

      // Delete documents in a batch
      let batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      return batch.commit().then(() => {
        return snapshot.size;
      });
    }).then((numDeleted) => {
      if (numDeleted === 0) {
        resolve();
        return;
      }

      // Recurse on the next process tick, to avoid
      // exploding the stack.
      window.setTimeout(() => {
        deleteQueryBatch(db, query, batchSize, resolve, reject);
      }, 0);
    }).catch(reject);
}
