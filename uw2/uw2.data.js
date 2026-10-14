
  var Module = typeof Module != 'undefined' ? Module : {};

  Module['expectedDataFileDownloads'] ??= 0;
  Module['expectedDataFileDownloads']++;
  (() => {
    // Do not attempt to redownload the virtual filesystem data when in a pthread or a Wasm Worker context.
    var isPthread = typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD;
    var isWasmWorker = typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER;
    if (isPthread || isWasmWorker) return;
    async function loadPackage(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'uw2.data';
      var REMOTE_PACKAGE_BASE = 'uw2.data';
      var REMOTE_PACKAGE_NAME = Module['locateFile']?.(REMOTE_PACKAGE_BASE, '') ?? REMOTE_PACKAGE_BASE;
      var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];

      async function fetchRemotePackage(packageName, packageSize) {
        
        Module['dataFileDownloads'] ??= {};
        try {
          var response = await fetch(packageName);
        } catch (e) {
          throw new Error(`Network Error: ${packageName}`, {e});
        }
        if (!response.ok) {
          throw new Error(`${response.status}: ${response.url}`);
        }

        const chunks = [];
        const headers = response.headers;
        const total = Number(headers.get('Content-Length') ?? packageSize);
        let loaded = 0;

        Module['setStatus']?.('Downloading data...');
        const reader = response.body.getReader();

        while (1) {
          var {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          Module['dataFileDownloads'][packageName] = {loaded, total};

          let totalLoaded = 0;
          let totalSize = 0;

          for (const download of Object.values(Module['dataFileDownloads'])) {
            totalLoaded += download.loaded;
            totalSize += download.total;
          }

          Module['setStatus']?.(`Downloading data... (${totalLoaded}/${totalSize})`);
        }

        const packageData = new Uint8Array(chunks.map((c) => c.length).reduce((a, b) => a + b, 0));
        let offset = 0;
        for (const chunk of chunks) {
          packageData.set(chunk, offset);
          offset += chunk.length;
        }
        return packageData.buffer;
      }

    async function runWithFS(Module) {

      function assert(check, msg) {
        if (!check) throw new Error(msg);
      }
Module['FS_createPath']("/", "game", true, true);
Module['FS_createPath']("/game", "CRIT", true, true);
Module['FS_createPath']("/game", "CUTS", true, true);
Module['FS_createPath']("/game", "DATA", true, true);
Module['FS_createPath']("/game", "SOUND", true, true);
Module['FS_createPath']("/game", "roms", true, true);

      for (var file of metadata['files']) {
        var name = file['filename']
        Module['addRunDependency'](`fp ${name}`);
      }

        var PACKAGE_UUID = metadata['package_uuid'];
        var IDB_RO = "readonly";
        var IDB_RW = "readwrite";
        var DB_NAME = "EM_PRELOAD_CACHE";
        var DB_VERSION = 1;
        var METADATA_STORE_NAME = 'METADATA';
        var PACKAGE_STORE_NAME = 'PACKAGES';

        async function openDatabase() {
          if (typeof indexedDB == 'undefined') {
            throw new Error('using IndexedDB to cache data can only be done on a web page or in a web worker');
          }
          return new Promise((resolve, reject) => {
            var openRequest = indexedDB.open(DB_NAME, DB_VERSION);
            openRequest.onupgradeneeded = (event) => {
              var db = /** @type {IDBDatabase} */ (event.target.result);

              if (db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
                db.deleteObjectStore(PACKAGE_STORE_NAME);
              }
              var packages = db.createObjectStore(PACKAGE_STORE_NAME);

              if (db.objectStoreNames.contains(METADATA_STORE_NAME)) {
                db.deleteObjectStore(METADATA_STORE_NAME);
              }
              var metadata = db.createObjectStore(METADATA_STORE_NAME);
            };
            openRequest.onsuccess = (event) => {
              var db = /** @type {IDBDatabase} */ (event.target.result);
              resolve(db);
            };
            openRequest.onerror = reject;
          });
        }

        // This is needed as chromium has a limit on per-entry files in IndexedDB
        // https://cs.chromium.org/chromium/src/content/renderer/indexed_db/webidbdatabase_impl.cc?type=cs&sq=package:chromium&g=0&l=177
        // https://cs.chromium.org/chromium/src/out/Debug/gen/third_party/blink/public/mojom/indexeddb/indexeddb.mojom.h?type=cs&sq=package:chromium&g=0&l=60
        // We set the chunk size to 64MB to stay well-below the limit
        var CHUNK_SIZE = 64 * 1024 * 1024;

        async function cacheRemotePackage(db, packageName, packageData, packageMeta) {
          var transactionPackages = db.transaction([PACKAGE_STORE_NAME], IDB_RW);
          var packages = transactionPackages.objectStore(PACKAGE_STORE_NAME);
          var chunkSliceStart = 0;
          var nextChunkSliceStart = 0;
          var chunkCount = Math.ceil(packageData.byteLength / CHUNK_SIZE);
          var finishedChunks = 0;

          return new Promise((resolve, reject) => {
            for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
              nextChunkSliceStart += CHUNK_SIZE;
              var putPackageRequest = packages.put(
                packageData.slice(chunkSliceStart, nextChunkSliceStart),
                `package/${packageName}/${chunkId}`
              );
              chunkSliceStart = nextChunkSliceStart;
              putPackageRequest.onsuccess = (event) => {
                finishedChunks++;
                if (finishedChunks == chunkCount) {
                  var transaction_metadata = db.transaction(
                    [METADATA_STORE_NAME],
                    IDB_RW
                  );
                  var metadata = transaction_metadata.objectStore(METADATA_STORE_NAME);
                  var putMetadataRequest = metadata.put(
                    {
                      'uuid': packageMeta.uuid,
                      'chunkCount': chunkCount
                    },
                    `metadata/${packageName}`
                  );
                  putMetadataRequest.onsuccess = (event) => resolve(packageData);
                  putMetadataRequest.onerror = reject;
                }
              };
              putPackageRequest.onerror = reject;
            }
          });
        }

        /*
         * Check if there's a cached package, and if so whether it's the latest available.
         * Resolves to the cached metadata, or `null` if it is missing or out-of-date.
         */
        async function checkCachedPackage(db, packageName) {
          var transaction = db.transaction([METADATA_STORE_NAME], IDB_RO);
          var metadata = transaction.objectStore(METADATA_STORE_NAME);
          var getRequest = metadata.get(`metadata/${packageName}`);
          return new Promise((resolve, reject) => {
            getRequest.onsuccess = (event) => {
              var result = event.target.result;
              if (result && PACKAGE_UUID === result['uuid']) {
                resolve(result);
              } else {
                resolve(null);
              }
            }
            getRequest.onerror = reject;
          });
        }

        async function fetchCachedPackage(db, packageName, metadata) {
          var transaction = db.transaction([PACKAGE_STORE_NAME], IDB_RO);
          var packages = transaction.objectStore(PACKAGE_STORE_NAME);

          var chunksDone = 0;
          var totalSize = 0;
          var chunkCount = metadata['chunkCount'];
          var chunks = new Array(chunkCount);

          return new Promise((resolve, reject) => {
            for (var chunkId = 0; chunkId < chunkCount; chunkId++) {
              var getRequest = packages.get(`package/${packageName}/${chunkId}`);
              getRequest.onsuccess = (event) => {
                if (!event.target.result) {
                  reject(`CachedPackageNotFound for: ${packageName}`);
                  return;
                }
                // If there's only 1 chunk, there's nothing to concatenate it with so we can just return it now
                if (chunkCount == 1) {
                  resolve(event.target.result);
                } else {
                  chunksDone++;
                  totalSize += event.target.result.byteLength;
                  chunks.push(event.target.result);
                  if (chunksDone == chunkCount) {
                    if (chunksDone == 1) {
                      resolve(event.target.result);
                    } else {
                      var tempTyped = new Uint8Array(totalSize);
                      var byteOffset = 0;
                      for (var chunkId in chunks) {
                        var buffer = chunks[chunkId];
                        tempTyped.set(new Uint8Array(buffer), byteOffset);
                        byteOffset += buffer.byteLength;
                        buffer = undefined;
                      }
                      chunks = undefined;
                      resolve(tempTyped.buffer);
                      tempTyped = undefined;
                    }
                  }
                }
              };
              getRequest.onerror = reject;
            }
          });
        }

      async function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer.constructor.name === ArrayBuffer.name, 'bad input to processPackageData');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          for (var file of metadata['files']) {
            var name = file['filename'];
            var data = byteArray.subarray(file['start'], file['end']);
            // canOwn this data in the filesystem, it is a slice into the heap that will never change
          Module['FS_createDataFile'](name, null, data, true, true, true);
          Module['removeRunDependency'](`fp ${name}`);
          }
          Module['removeRunDependency']('datafile_uw2.data');
      }
      Module['addRunDependency']('datafile_uw2.data');

      Module['preloadResults'] ??= {};

        async function preloadFallback(error) {
          console.error(error);
          console.error('falling back to default preload behavior');
          processPackageData(await fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE));
        }

        try {
          var db = await openDatabase();
          var pkgMetadata = await checkCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME);
          var useCached = !!pkgMetadata;
          Module['preloadResults'][PACKAGE_NAME] = {fromCache: useCached};
          if (useCached) {
            processPackageData(await fetchCachedPackage(db, PACKAGE_PATH + PACKAGE_NAME, pkgMetadata));
          } else {
            var packageData = await fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE);
            try {
              processPackageData(await cacheRemotePackage(db, PACKAGE_PATH + PACKAGE_NAME, packageData, {uuid:PACKAGE_UUID}))
            } catch (error) {
              console.error(error);
              processPackageData(packageData);
            }
          }
        } catch(e) {
          await preloadFallback(e);
        }

        Module['setStatus']?.('Downloading...');

    }
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      (Module['preRun'] ??= []).push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/game/CRIT/AS.AN", "start": 0, "end": 128}, {"filename": "/game/CRIT/CR.AN", "start": 128, "end": 16512}, {"filename": "/game/CRIT/CR00.00", "start": 16512, "end": 29164}, {"filename": "/game/CRIT/CR01.00", "start": 29164, "end": 61592}, {"filename": "/game/CRIT/CR01.01", "start": 61592, "end": 73195}, {"filename": "/game/CRIT/CR02.00", "start": 73195, "end": 105787}, {"filename": "/game/CRIT/CR02.01", "start": 105787, "end": 138311}, {"filename": "/game/CRIT/CR02.02", "start": 138311, "end": 144367}, {"filename": "/game/CRIT/CR03.00", "start": 144367, "end": 156962}, {"filename": "/game/CRIT/CR04.00", "start": 156962, "end": 189443}, {"filename": "/game/CRIT/CR04.01", "start": 189443, "end": 196245}, {"filename": "/game/CRIT/CR05.00", "start": 196245, "end": 228922}, {"filename": "/game/CRIT/CR05.01", "start": 228922, "end": 247677}, {"filename": "/game/CRIT/CR06.00", "start": 247677, "end": 280193}, {"filename": "/game/CRIT/CR06.01", "start": 280193, "end": 312584}, {"filename": "/game/CRIT/CR06.02", "start": 312584, "end": 313827}, {"filename": "/game/CRIT/CR07.00", "start": 313827, "end": 346548}, {"filename": "/game/CRIT/CR07.01", "start": 346548, "end": 378840}, {"filename": "/game/CRIT/CR07.02", "start": 378840, "end": 380162}, {"filename": "/game/CRIT/CR10.00", "start": 380162, "end": 412535}, {"filename": "/game/CRIT/CR10.01", "start": 412535, "end": 440960}, {"filename": "/game/CRIT/CR11.00", "start": 440960, "end": 467578}, {"filename": "/game/CRIT/CR12.00", "start": 467578, "end": 500057}, {"filename": "/game/CRIT/CR12.01", "start": 500057, "end": 532427}, {"filename": "/game/CRIT/CR12.02", "start": 532427, "end": 553881}, {"filename": "/game/CRIT/CR13.00", "start": 553881, "end": 586612}, {"filename": "/game/CRIT/CR13.01", "start": 586612, "end": 619372}, {"filename": "/game/CRIT/CR13.02", "start": 619372, "end": 652029}, {"filename": "/game/CRIT/CR13.03", "start": 652029, "end": 674825}, {"filename": "/game/CRIT/CR14.00", "start": 674825, "end": 706855}, {"filename": "/game/CRIT/CR14.01", "start": 706855, "end": 720772}, {"filename": "/game/CRIT/CR15.00", "start": 720772, "end": 752602}, {"filename": "/game/CRIT/CR15.01", "start": 752602, "end": 765497}, {"filename": "/game/CRIT/CR16.00", "start": 765497, "end": 793997}, {"filename": "/game/CRIT/CR17.00", "start": 793997, "end": 825911}, {"filename": "/game/CRIT/CR17.01", "start": 825911, "end": 858299}, {"filename": "/game/CRIT/CR17.02", "start": 858299, "end": 882771}, {"filename": "/game/CRIT/CR20.00", "start": 882771, "end": 914349}, {"filename": "/game/CRIT/CR20.01", "start": 914349, "end": 945501}, {"filename": "/game/CRIT/CR20.02", "start": 945501, "end": 977906}, {"filename": "/game/CRIT/CR20.03", "start": 977906, "end": 1008418}, {"filename": "/game/CRIT/CR20.04", "start": 1008418, "end": 1039618}, {"filename": "/game/CRIT/CR20.05", "start": 1039618, "end": 1060859}, {"filename": "/game/CRIT/CR21.00", "start": 1060859, "end": 1093025}, {"filename": "/game/CRIT/CR21.01", "start": 1093025, "end": 1124896}, {"filename": "/game/CRIT/CR21.02", "start": 1124896, "end": 1156833}, {"filename": "/game/CRIT/CR21.03", "start": 1156833, "end": 1188476}, {"filename": "/game/CRIT/CR21.04", "start": 1188476, "end": 1219923}, {"filename": "/game/CRIT/CR21.05", "start": 1219923, "end": 1228877}, {"filename": "/game/CRIT/CR22.00", "start": 1228877, "end": 1260554}, {"filename": "/game/CRIT/CR22.01", "start": 1260554, "end": 1292245}, {"filename": "/game/CRIT/CR22.02", "start": 1292245, "end": 1307009}, {"filename": "/game/CRIT/CR23.00", "start": 1307009, "end": 1339688}, {"filename": "/game/CRIT/CR23.01", "start": 1339688, "end": 1359651}, {"filename": "/game/CRIT/CR24.00", "start": 1359651, "end": 1391610}, {"filename": "/game/CRIT/CR24.01", "start": 1391610, "end": 1422616}, {"filename": "/game/CRIT/CR24.02", "start": 1422616, "end": 1447849}, {"filename": "/game/CRIT/CR25.00", "start": 1447849, "end": 1480558}, {"filename": "/game/CRIT/CR25.01", "start": 1480558, "end": 1503298}, {"filename": "/game/CRIT/CR26.00", "start": 1503298, "end": 1535270}, {"filename": "/game/CRIT/CR26.01", "start": 1535270, "end": 1559886}, {"filename": "/game/CRIT/CR27.00", "start": 1559886, "end": 1592129}, {"filename": "/game/CRIT/CR27.01", "start": 1592129, "end": 1622022}, {"filename": "/game/CRIT/CR30.00", "start": 1622022, "end": 1654547}, {"filename": "/game/CRIT/CR30.01", "start": 1654547, "end": 1684550}, {"filename": "/game/CRIT/CR31.00", "start": 1684550, "end": 1717116}, {"filename": "/game/CRIT/CR31.01", "start": 1717116, "end": 1736129}, {"filename": "/game/CRIT/CR32.00", "start": 1736129, "end": 1768749}, {"filename": "/game/CRIT/CR32.01", "start": 1768749, "end": 1795523}, {"filename": "/game/CRIT/CR33.00", "start": 1795523, "end": 1827912}, {"filename": "/game/CRIT/CR33.01", "start": 1827912, "end": 1850019}, {"filename": "/game/CRIT/CR34.00", "start": 1850019, "end": 1882475}, {"filename": "/game/CRIT/CR34.01", "start": 1882475, "end": 1889820}, {"filename": "/game/CRIT/CR35.00", "start": 1889820, "end": 1922567}, {"filename": "/game/CRIT/CR35.01", "start": 1922567, "end": 1928489}, {"filename": "/game/CRIT/CR36.00", "start": 1928489, "end": 1960691}, {"filename": "/game/CRIT/CR36.01", "start": 1960691, "end": 1992560}, {"filename": "/game/CRIT/CR36.02", "start": 1992560, "end": 2001152}, {"filename": "/game/CRIT/CR37.00", "start": 2001152, "end": 2032978}, {"filename": "/game/CRIT/CR37.01", "start": 2032978, "end": 2063419}, {"filename": "/game/CRIT/CR37.02", "start": 2063419, "end": 2069104}, {"filename": "/game/CRIT/PG.MP", "start": 2069104, "end": 2069360}, {"filename": "/game/CUTS/CS000.N00", "start": 2069360, "end": 2069858}, {"filename": "/game/CUTS/CS000.N01", "start": 2069858, "end": 2159753}, {"filename": "/game/CUTS/CS000.N02", "start": 2159753, "end": 2219435}, {"filename": "/game/CUTS/CS000.N03", "start": 2219435, "end": 2287787}, {"filename": "/game/CUTS/CS000.N04", "start": 2287787, "end": 2337304}, {"filename": "/game/CUTS/CS000.N05", "start": 2337304, "end": 2399119}, {"filename": "/game/CUTS/CS000.N06", "start": 2399119, "end": 2467471}, {"filename": "/game/CUTS/CS000.N07", "start": 2467471, "end": 2520522}, {"filename": "/game/CUTS/CS000.N10", "start": 2520522, "end": 2584421}, {"filename": "/game/CUTS/CS000.N11", "start": 2584421, "end": 2620500}, {"filename": "/game/CUTS/CS000.N12", "start": 2620500, "end": 2753018}, {"filename": "/game/CUTS/CS000.N13", "start": 2753018, "end": 2793524}, {"filename": "/game/CUTS/CS000.N14", "start": 2793524, "end": 3120779}, {"filename": "/game/CUTS/CS000.N15", "start": 3120779, "end": 3123675}, {"filename": "/game/CUTS/CS001.N00", "start": 3123675, "end": 3123747}, {"filename": "/game/CUTS/CS001.N01", "start": 3123747, "end": 3383559}, {"filename": "/game/CUTS/CS001.N02", "start": 3383559, "end": 3571617}, {"filename": "/game/CUTS/CS001.N03", "start": 3571617, "end": 3639151}, {"filename": "/game/CUTS/CS001.N04", "start": 3639151, "end": 3764816}, {"filename": "/game/CUTS/CS001.N05", "start": 3764816, "end": 3803454}, {"filename": "/game/CUTS/CS002.N00", "start": 3803454, "end": 3803738}, {"filename": "/game/CUTS/CS002.N01", "start": 3803738, "end": 3853117}, {"filename": "/game/CUTS/CS002.N02", "start": 3853117, "end": 3921469}, {"filename": "/game/CUTS/CS002.N03", "start": 3921469, "end": 4027869}, {"filename": "/game/CUTS/CS002.N04", "start": 4027869, "end": 4158054}, {"filename": "/game/CUTS/CS002.N05", "start": 4158054, "end": 4291285}, {"filename": "/game/CUTS/CS002.N06", "start": 4291285, "end": 4321030}, {"filename": "/game/CUTS/CS002.N07", "start": 4321030, "end": 4324671}, {"filename": "/game/CUTS/CS002.N10", "start": 4324671, "end": 4359241}, {"filename": "/game/CUTS/CS004.N00", "start": 4359241, "end": 4359275}, {"filename": "/game/CUTS/CS005.N00", "start": 4359275, "end": 4359309}, {"filename": "/game/CUTS/CS006.N00", "start": 4359309, "end": 4359343}, {"filename": "/game/CUTS/CS007.N00", "start": 4359343, "end": 4359377}, {"filename": "/game/CUTS/CS011.N00", "start": 4359377, "end": 4359387}, {"filename": "/game/CUTS/CS011.N01", "start": 4359387, "end": 4687537}, {"filename": "/game/CUTS/CS012.N00", "start": 4687537, "end": 4687547}, {"filename": "/game/CUTS/CS012.N01", "start": 4687547, "end": 5080729}, {"filename": "/game/CUTS/CS030.N00", "start": 5080729, "end": 5080797}, {"filename": "/game/CUTS/CS030.N01", "start": 5080797, "end": 5113767}, {"filename": "/game/CUTS/CS031.N00", "start": 5113767, "end": 5113815}, {"filename": "/game/CUTS/CS031.N01", "start": 5113815, "end": 5155593}, {"filename": "/game/CUTS/CS032.N00", "start": 5155593, "end": 5155631}, {"filename": "/game/CUTS/CS032.N01", "start": 5155631, "end": 5195125}, {"filename": "/game/CUTS/CS033.N00", "start": 5195125, "end": 5195173}, {"filename": "/game/CUTS/CS033.N01", "start": 5195173, "end": 5221213}, {"filename": "/game/CUTS/CS034.N00", "start": 5221213, "end": 5221247}, {"filename": "/game/CUTS/CS034.N01", "start": 5221247, "end": 5267934}, {"filename": "/game/CUTS/CS035.N00", "start": 5267934, "end": 5267968}, {"filename": "/game/CUTS/CS035.N01", "start": 5267968, "end": 5308558}, {"filename": "/game/CUTS/CS036.N00", "start": 5308558, "end": 5308592}, {"filename": "/game/CUTS/CS036.N01", "start": 5308592, "end": 5344032}, {"filename": "/game/CUTS/CS037.N01", "start": 5344032, "end": 5379472}, {"filename": "/game/CUTS/CS040.N00", "start": 5379472, "end": 5379562}, {"filename": "/game/CUTS/CS040.N01", "start": 5379562, "end": 5390594}, {"filename": "/game/CUTS/CS403.N00", "start": 5390594, "end": 5390614}, {"filename": "/game/CUTS/CS403.N01", "start": 5390614, "end": 5523684}, {"filename": "/game/CUTS/CS403.N02", "start": 5523684, "end": 5537107}, {"filename": "/game/CUTS/LBACK000.BYT", "start": 5537107, "end": 5601107}, {"filename": "/game/CUTS/LBACK001.BYT", "start": 5601107, "end": 5665107}, {"filename": "/game/CUTS/LBACK002.BYT", "start": 5665107, "end": 5729107}, {"filename": "/game/CUTS/LBACK003.BYT", "start": 5729107, "end": 5793107}, {"filename": "/game/CUTS/LBACK004.BYT", "start": 5793107, "end": 5857107}, {"filename": "/game/CUTS/LBACK005.BYT", "start": 5857107, "end": 5921107}, {"filename": "/game/CUTS/LBACK006.BYT", "start": 5921107, "end": 5985107}, {"filename": "/game/CUTS/LBACK007.BYT", "start": 5985107, "end": 6049107}, {"filename": "/game/DATA/3DWIN.GR", "start": 6049107, "end": 6049236}, {"filename": "/game/DATA/ALLPALS.DAT", "start": 6049236, "end": 6049749}, {"filename": "/game/DATA/ANIMO.GR", "start": 6049749, "end": 6054362}, {"filename": "/game/DATA/ARMOR_F.GR", "start": 6054362, "end": 6100672}, {"filename": "/game/DATA/ARMOR_M.GR", "start": 6100672, "end": 6146982}, {"filename": "/game/DATA/BABGLOBS.DAT", "start": 6146982, "end": 6147390}, {"filename": "/game/DATA/BODIES.GR", "start": 6147390, "end": 6172327}, {"filename": "/game/DATA/BUTTONS.GR", "start": 6172327, "end": 6180294}, {"filename": "/game/DATA/BYT.ARK", "start": 6180294, "end": 6353535}, {"filename": "/game/DATA/CHAINS.GR", "start": 6353535, "end": 6355498}, {"filename": "/game/DATA/CHARHEAD.GR", "start": 6355498, "end": 6719462}, {"filename": "/game/DATA/CHRBTNS.GR", "start": 6719462, "end": 6760758}, {"filename": "/game/DATA/CHRGEN.DAT", "start": 6760758, "end": 6760996}, {"filename": "/game/DATA/CMB.DAT", "start": 6760996, "end": 6761056}, {"filename": "/game/DATA/CNV.ARK", "start": 6761056, "end": 7042713}, {"filename": "/game/DATA/COMOBJ.DAT", "start": 7042713, "end": 7048347}, {"filename": "/game/DATA/COMPASS.GR", "start": 7048347, "end": 7052589}, {"filename": "/game/DATA/CONTROLS.DAT", "start": 7052589, "end": 7052613}, {"filename": "/game/DATA/CONVERSE.GR", "start": 7052613, "end": 7070470}, {"filename": "/game/DATA/CURSORS.GR", "start": 7070470, "end": 7072281}, {"filename": "/game/DATA/DL.DAT", "start": 7072281, "end": 7072361}, {"filename": "/game/DATA/DOORS.GR", "start": 7072361, "end": 7099109}, {"filename": "/game/DATA/DRAGONS.GR", "start": 7099109, "end": 7115373}, {"filename": "/game/DATA/EYES.GR", "start": 7115373, "end": 7116070}, {"filename": "/game/DATA/FLASKS.GR", "start": 7116070, "end": 7126850}, {"filename": "/game/DATA/FONT4X5P.SYS", "start": 7126850, "end": 7127347}, {"filename": "/game/DATA/FONT5X6I.SYS", "start": 7127347, "end": 7128375}, {"filename": "/game/DATA/FONT5X6P.SYS", "start": 7128375, "end": 7129276}, {"filename": "/game/DATA/FONTBIG.SYS", "start": 7129276, "end": 7133225}, {"filename": "/game/DATA/FONTBUTN.SYS", "start": 7133225, "end": 7134459}, {"filename": "/game/DATA/FONTCHAR.SYS", "start": 7134459, "end": 7137138}, {"filename": "/game/DATA/GEMPT.GR", "start": 7137138, "end": 7141735}, {"filename": "/game/DATA/GENHEAD.GR", "start": 7141735, "end": 7176828}, {"filename": "/game/DATA/GHED.GR", "start": 7176828, "end": 7248921}, {"filename": "/game/DATA/GRAVE.DAT", "start": 7248921, "end": 7249433}, {"filename": "/game/DATA/HEADS.GR", "start": 7249433, "end": 7294330}, {"filename": "/game/DATA/INV.GR", "start": 7294330, "end": 7303569}, {"filename": "/game/DATA/LEV.ARK", "start": 7303569, "end": 7670763}, {"filename": "/game/DATA/LFTI.GR", "start": 7670763, "end": 7677144}, {"filename": "/game/DATA/LIGHT.DAT", "start": 7677144, "end": 7681240}, {"filename": "/game/DATA/LIGHTING.DAT", "start": 7681240, "end": 7699798}, {"filename": "/game/DATA/LIGHTS.DAT", "start": 7699798, "end": 7699806}, {"filename": "/game/DATA/MONO.DAT", "start": 7699806, "end": 7703902}, {"filename": "/game/DATA/OBJECTS.DAT", "start": 7703902, "end": 7707456}, {"filename": "/game/DATA/OBJECTS.GR", "start": 7707456, "end": 7739953}, {"filename": "/game/DATA/OPBTN.GR", "start": 7739953, "end": 7765682}, {"filename": "/game/DATA/OPTB.GR", "start": 7765682, "end": 7784852}, {"filename": "/game/DATA/OPTBTNS.GR", "start": 7784852, "end": 7900102}, {"filename": "/game/DATA/PALS.DAT", "start": 7900102, "end": 7908550}, {"filename": "/game/DATA/PANELS.GR", "start": 7908550, "end": 7935453}, {"filename": "/game/DATA/PLAYER.DAT", "start": 7935453, "end": 7935754}, {"filename": "/game/DATA/POWER.GR", "start": 7935754, "end": 7936630}, {"filename": "/game/DATA/QUESTION.GR", "start": 7936630, "end": 7936775}, {"filename": "/game/DATA/SCD.ARK", "start": 7936775, "end": 7945725}, {"filename": "/game/DATA/SCRLEDGE.GR", "start": 7945725, "end": 7948386}, {"filename": "/game/DATA/SHADES.DAT", "start": 7948386, "end": 7948482}, {"filename": "/game/DATA/SKILLS.DAT", "start": 7948482, "end": 7948673}, {"filename": "/game/DATA/SPELLS.GR", "start": 7948673, "end": 7956125}, {"filename": "/game/DATA/STRINGS.PAK", "start": 7956125, "end": 8386855}, {"filename": "/game/DATA/T64.TR", "start": 8386855, "end": 9436495}, {"filename": "/game/DATA/TERRAIN.DAT", "start": 9436495, "end": 9437007}, {"filename": "/game/DATA/TMFLAT.GR", "start": 9437007, "end": 9441254}, {"filename": "/game/DATA/TMOBJ.GR", "start": 9441254, "end": 9473491}, {"filename": "/game/DATA/UW.CFG", "start": 9473491, "end": 9473528}, {"filename": "/game/DATA/VIEWS.GR", "start": 9473528, "end": 9473619}, {"filename": "/game/DATA/WEAP.CM", "start": 9473619, "end": 9473683}, {"filename": "/game/DATA/WEAP.DAT", "start": 9473683, "end": 9474459}, {"filename": "/game/DATA/WEAP.GR", "start": 9474459, "end": 9566185}, {"filename": "/game/DATA/XFER.DAT", "start": 9566185, "end": 9567465}, {"filename": "/game/INSTALL.DAT", "start": 9567465, "end": 9567947}, {"filename": "/game/INSTALL.OLB", "start": 9567947, "end": 9610532}, {"filename": "/game/SOUND/BSP00.VOC", "start": 9610532, "end": 9783605}, {"filename": "/game/SOUND/BSP02.VOC", "start": 9783605, "end": 9855583}, {"filename": "/game/SOUND/BSP03.VOC", "start": 9855583, "end": 9895410}, {"filename": "/game/SOUND/BSP04.VOC", "start": 9895410, "end": 9945117}, {"filename": "/game/SOUND/BSP05.VOC", "start": 9945117, "end": 9992330}, {"filename": "/game/SOUND/BSP06.VOC", "start": 9992330, "end": 10047585}, {"filename": "/game/SOUND/BSP07.VOC", "start": 10047585, "end": 10084127}, {"filename": "/game/SOUND/BSP12.VOC", "start": 10084127, "end": 10117924}, {"filename": "/game/SOUND/DD01.ADV", "start": 10117924, "end": 10122591}, {"filename": "/game/SOUND/DD02.ADV", "start": 10122591, "end": 10127537}, {"filename": "/game/SOUND/DD03.ADV", "start": 10127537, "end": 10131898}, {"filename": "/game/SOUND/DM01.ADV", "start": 10131898, "end": 10140250}, {"filename": "/game/SOUND/DM02.ADV", "start": 10140250, "end": 10157176}, {"filename": "/game/SOUND/DM03.ADV", "start": 10157176, "end": 10174152}, {"filename": "/game/SOUND/DM04.ADV", "start": 10174152, "end": 10191538}, {"filename": "/game/SOUND/DM05.ADV", "start": 10191538, "end": 10202163}, {"filename": "/game/SOUND/DM06.ADV", "start": 10202163, "end": 10219556}, {"filename": "/game/SOUND/DM07.ADV", "start": 10219556, "end": 10238244}, {"filename": "/game/SOUND/SAMPLE.OPL", "start": 10238244, "end": 10249726}, {"filename": "/game/SOUND/SOUNDS.DAT", "start": 10249726, "end": 10250119}, {"filename": "/game/SOUND/SP01.VOC", "start": 10250119, "end": 10254983}, {"filename": "/game/SOUND/SP02.VOC", "start": 10254983, "end": 10259431}, {"filename": "/game/SOUND/SP03.VOC", "start": 10259431, "end": 10262051}, {"filename": "/game/SOUND/SP04.VOC", "start": 10262051, "end": 10264412}, {"filename": "/game/SOUND/SP05.VOC", "start": 10264412, "end": 10295719}, {"filename": "/game/SOUND/SP06.VOC", "start": 10295719, "end": 10299471}, {"filename": "/game/SOUND/SP07.VOC", "start": 10299471, "end": 10306513}, {"filename": "/game/SOUND/SP08.VOC", "start": 10306513, "end": 10313374}, {"filename": "/game/SOUND/SP09.VOC", "start": 10313374, "end": 10320069}, {"filename": "/game/SOUND/SP10.VOC", "start": 10320069, "end": 10326499}, {"filename": "/game/SOUND/SP11.VOC", "start": 10326499, "end": 10352581}, {"filename": "/game/SOUND/SP12.VOC", "start": 10352581, "end": 10356679}, {"filename": "/game/SOUND/SP18.VOC", "start": 10356679, "end": 10382321}, {"filename": "/game/SOUND/SP20.VOC", "start": 10382321, "end": 10398982}, {"filename": "/game/SOUND/SP24.VOC", "start": 10398982, "end": 10404759}, {"filename": "/game/SOUND/SP25.VOC", "start": 10404759, "end": 10420220}, {"filename": "/game/SOUND/SP26.VOC", "start": 10420220, "end": 10432862}, {"filename": "/game/SOUND/SP27.VOC", "start": 10432862, "end": 10433971}, {"filename": "/game/SOUND/SP28.VOC", "start": 10433971, "end": 10435929}, {"filename": "/game/SOUND/SP29.VOC", "start": 10435929, "end": 10442614}, {"filename": "/game/SOUND/SP30.VOC", "start": 10442614, "end": 10447799}, {"filename": "/game/SOUND/SP31.VOC", "start": 10447799, "end": 10467539}, {"filename": "/game/SOUND/SP33.VOC", "start": 10467539, "end": 10485340}, {"filename": "/game/SOUND/SP34.VOC", "start": 10485340, "end": 10488272}, {"filename": "/game/SOUND/SP35.VOC", "start": 10488272, "end": 10493616}, {"filename": "/game/SOUND/SP36.VOC", "start": 10493616, "end": 10499088}, {"filename": "/game/SOUND/SP37.VOC", "start": 10499088, "end": 10510129}, {"filename": "/game/SOUND/SP40.VOC", "start": 10510129, "end": 10516559}, {"filename": "/game/SOUND/SP47.VOC", "start": 10516559, "end": 10520844}, {"filename": "/game/SOUND/SP48.VOC", "start": 10520844, "end": 10524932}, {"filename": "/game/SOUND/UW.AD", "start": 10524932, "end": 10536462}, {"filename": "/game/SOUND/UW.MT", "start": 10536462, "end": 10552720}, {"filename": "/game/SOUND/UW.OPL", "start": 10552720, "end": 10564250}, {"filename": "/game/SOUND/UW00.VOC", "start": 10564250, "end": 10602806}, {"filename": "/game/SOUND/UW01.VOC", "start": 10602806, "end": 10636871}, {"filename": "/game/SOUND/UWA01.XMI", "start": 10636871, "end": 10644781}, {"filename": "/game/SOUND/UWA02.XMI", "start": 10644781, "end": 10646081}, {"filename": "/game/SOUND/UWA03.XMI", "start": 10646081, "end": 10648457}, {"filename": "/game/SOUND/UWA04.XMI", "start": 10648457, "end": 10650487}, {"filename": "/game/SOUND/UWA05.XMI", "start": 10650487, "end": 10652757}, {"filename": "/game/SOUND/UWA06.XMI", "start": 10652757, "end": 10653031}, {"filename": "/game/SOUND/UWA07.XMI", "start": 10653031, "end": 10653887}, {"filename": "/game/SOUND/UWA10.XMI", "start": 10653887, "end": 10662813}, {"filename": "/game/SOUND/UWA11.XMI", "start": 10662813, "end": 10666387}, {"filename": "/game/SOUND/UWA12.XMI", "start": 10666387, "end": 10668409}, {"filename": "/game/SOUND/UWA13.XMI", "start": 10668409, "end": 10672201}, {"filename": "/game/SOUND/UWA14.XMI", "start": 10672201, "end": 10677317}, {"filename": "/game/SOUND/UWA15.XMI", "start": 10677317, "end": 10681215}, {"filename": "/game/SOUND/UWA16.XMI", "start": 10681215, "end": 10684307}, {"filename": "/game/SOUND/UWA17.XMI", "start": 10684307, "end": 10692005}, {"filename": "/game/SOUND/UWA30.XMI", "start": 10692005, "end": 10693285}, {"filename": "/game/SOUND/UWA31.XMI", "start": 10693285, "end": 10696033}, {"filename": "/game/SOUND/UWR01.XMI", "start": 10696033, "end": 10703943}, {"filename": "/game/SOUND/UWR02.XMI", "start": 10703943, "end": 10705243}, {"filename": "/game/SOUND/UWR03.XMI", "start": 10705243, "end": 10707619}, {"filename": "/game/SOUND/UWR04.XMI", "start": 10707619, "end": 10709645}, {"filename": "/game/SOUND/UWR05.XMI", "start": 10709645, "end": 10711915}, {"filename": "/game/SOUND/UWR06.XMI", "start": 10711915, "end": 10712189}, {"filename": "/game/SOUND/UWR07.XMI", "start": 10712189, "end": 10713045}, {"filename": "/game/SOUND/UWR10.XMI", "start": 10713045, "end": 10721971}, {"filename": "/game/SOUND/UWR11.XMI", "start": 10721971, "end": 10725545}, {"filename": "/game/SOUND/UWR12.XMI", "start": 10725545, "end": 10727563}, {"filename": "/game/SOUND/UWR13.XMI", "start": 10727563, "end": 10731353}, {"filename": "/game/SOUND/UWR14.XMI", "start": 10731353, "end": 10736469}, {"filename": "/game/SOUND/UWR15.XMI", "start": 10736469, "end": 10740367}, {"filename": "/game/SOUND/UWR16.XMI", "start": 10740367, "end": 10743493}, {"filename": "/game/SOUND/UWR17.XMI", "start": 10743493, "end": 10751403}, {"filename": "/game/SOUND/UWR30.XMI", "start": 10751403, "end": 10752681}, {"filename": "/game/SOUND/UWR31.XMI", "start": 10752681, "end": 10754201}, {"filename": "/game/UINSTALL.EXE", "start": 10754201, "end": 10824857}, {"filename": "/game/UW2.EXE", "start": 10824857, "end": 11500041}, {"filename": "/game/UWSOUND.EXE", "start": 11500041, "end": 11521775}, {"filename": "/game/roms/cm32l_ctrl_1_02.rom", "start": 11521775, "end": 11587311}, {"filename": "/game/roms/cm32l_pcm.rom", "start": 11587311, "end": 12635887}], "remote_package_size": 12635887, "package_uuid": "sha256-4687a1726cf1e33db2eb12ee89685d393f7ce7dc0a0de56f70c1e90847c5730e"});

  })();
