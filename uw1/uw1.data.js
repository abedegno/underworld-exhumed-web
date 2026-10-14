
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
      var PACKAGE_NAME = 'uw1.data';
      var REMOTE_PACKAGE_BASE = 'uw1.data';
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
          Module['removeRunDependency']('datafile_uw1.data');
      }
      Module['addRunDependency']('datafile_uw1.data');

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
    loadPackage({"files": [{"filename": "/game/CRIT/ASSOC.ANM", "start": 0, "end": 384}, {"filename": "/game/CRIT/CR00PAGE.N00", "start": 384, "end": 17845}, {"filename": "/game/CRIT/CR00PAGE.N01", "start": 17845, "end": 49847}, {"filename": "/game/CRIT/CR01PAGE.N00", "start": 49847, "end": 56730}, {"filename": "/game/CRIT/CR01PAGE.N01", "start": 56730, "end": 76317}, {"filename": "/game/CRIT/CR02PAGE.N00", "start": 76317, "end": 85835}, {"filename": "/game/CRIT/CR02PAGE.N01", "start": 85835, "end": 115734}, {"filename": "/game/CRIT/CR03PAGE.N00", "start": 115734, "end": 116925}, {"filename": "/game/CRIT/CR03PAGE.N01", "start": 116925, "end": 118758}, {"filename": "/game/CRIT/CR04PAGE.N00", "start": 118758, "end": 128153}, {"filename": "/game/CRIT/CR04PAGE.N01", "start": 128153, "end": 147356}, {"filename": "/game/CRIT/CR05PAGE.N00", "start": 147356, "end": 154218}, {"filename": "/game/CRIT/CR05PAGE.N01", "start": 154218, "end": 166638}, {"filename": "/game/CRIT/CR06PAGE.N00", "start": 166638, "end": 176397}, {"filename": "/game/CRIT/CR06PAGE.N01", "start": 176397, "end": 185770}, {"filename": "/game/CRIT/CR07PAGE.N00", "start": 185770, "end": 195073}, {"filename": "/game/CRIT/CR07PAGE.N01", "start": 195073, "end": 221407}, {"filename": "/game/CRIT/CR10PAGE.N00", "start": 221407, "end": 226226}, {"filename": "/game/CRIT/CR10PAGE.N01", "start": 226226, "end": 244966}, {"filename": "/game/CRIT/CR11PAGE.N00", "start": 244966, "end": 245754}, {"filename": "/game/CRIT/CR11PAGE.N01", "start": 245754, "end": 250030}, {"filename": "/game/CRIT/CR12PAGE.N00", "start": 250030, "end": 262284}, {"filename": "/game/CRIT/CR12PAGE.N01", "start": 262284, "end": 277721}, {"filename": "/game/CRIT/CR13PAGE.N00", "start": 277721, "end": 290066}, {"filename": "/game/CRIT/CR13PAGE.N01", "start": 290066, "end": 315639}, {"filename": "/game/CRIT/CR14PAGE.N00", "start": 315639, "end": 329972}, {"filename": "/game/CRIT/CR14PAGE.N01", "start": 329972, "end": 355681}, {"filename": "/game/CRIT/CR15PAGE.N00", "start": 355681, "end": 359682}, {"filename": "/game/CRIT/CR15PAGE.N01", "start": 359682, "end": 366667}, {"filename": "/game/CRIT/CR16PAGE.N00", "start": 366667, "end": 378498}, {"filename": "/game/CRIT/CR16PAGE.N01", "start": 378498, "end": 404555}, {"filename": "/game/CRIT/CR17PAGE.N00", "start": 404555, "end": 415403}, {"filename": "/game/CRIT/CR17PAGE.N01", "start": 415403, "end": 437347}, {"filename": "/game/CRIT/CR20PAGE.N00", "start": 437347, "end": 440712}, {"filename": "/game/CRIT/CR20PAGE.N01", "start": 440712, "end": 452325}, {"filename": "/game/CRIT/CR21PAGE.N00", "start": 452325, "end": 461121}, {"filename": "/game/CRIT/CR21PAGE.N01", "start": 461121, "end": 486688}, {"filename": "/game/CRIT/CR22PAGE.N00", "start": 486688, "end": 492528}, {"filename": "/game/CRIT/CR22PAGE.N01", "start": 492528, "end": 501338}, {"filename": "/game/CRIT/CR23PAGE.N00", "start": 501338, "end": 514599}, {"filename": "/game/CRIT/CR23PAGE.N01", "start": 514599, "end": 535080}, {"filename": "/game/CRIT/CR24PAGE.N00", "start": 535080, "end": 544335}, {"filename": "/game/CRIT/CR24PAGE.N01", "start": 544335, "end": 561158}, {"filename": "/game/CRIT/CR25PAGE.N00", "start": 561158, "end": 567612}, {"filename": "/game/CRIT/CR25PAGE.N01", "start": 567612, "end": 588489}, {"filename": "/game/CRIT/CR26PAGE.N00", "start": 588489, "end": 589661}, {"filename": "/game/CRIT/CR26PAGE.N01", "start": 589661, "end": 594092}, {"filename": "/game/CRIT/CR27PAGE.N00", "start": 594092, "end": 594747}, {"filename": "/game/CRIT/CR27PAGE.N01", "start": 594747, "end": 595570}, {"filename": "/game/CRIT/CR30PAGE.N00", "start": 595570, "end": 595680}, {"filename": "/game/CRIT/CR30PAGE.N01", "start": 595680, "end": 614732}, {"filename": "/game/CRIT/CR31PAGE.N00", "start": 614732, "end": 621479}, {"filename": "/game/CRIT/CR31PAGE.N01", "start": 621479, "end": 629028}, {"filename": "/game/CRIT/CR32PAGE.N00", "start": 629028, "end": 637864}, {"filename": "/game/CRIT/CR32PAGE.N01", "start": 637864, "end": 663469}, {"filename": "/game/CRIT/CR33PAGE.N00", "start": 663469, "end": 674469}, {"filename": "/game/CRIT/CR33PAGE.N01", "start": 674469, "end": 696314}, {"filename": "/game/CRIT/CR34PAGE.N00", "start": 696314, "end": 702094}, {"filename": "/game/CRIT/CR34PAGE.N01", "start": 702094, "end": 708450}, {"filename": "/game/CRIT/CR35PAGE.N00", "start": 708450, "end": 717823}, {"filename": "/game/CRIT/CR35PAGE.N01", "start": 717823, "end": 736898}, {"filename": "/game/CRIT/CR36PAGE.N00", "start": 736898, "end": 736976}, {"filename": "/game/CRIT/CR36PAGE.N01", "start": 736976, "end": 747974}, {"filename": "/game/CRIT/CR37PAGE.N00", "start": 747974, "end": 748052}, {"filename": "/game/CRIT/CR37PAGE.N01", "start": 748052, "end": 758838}, {"filename": "/game/CUTS/CS000.N00", "start": 758838, "end": 760520}, {"filename": "/game/CUTS/CS000.N01", "start": 760520, "end": 763393}, {"filename": "/game/CUTS/CS000.N02", "start": 763393, "end": 993125}, {"filename": "/game/CUTS/CS000.N03", "start": 993125, "end": 1035435}, {"filename": "/game/CUTS/CS000.N04", "start": 1035435, "end": 1100404}, {"filename": "/game/CUTS/CS000.N05", "start": 1100404, "end": 1166043}, {"filename": "/game/CUTS/CS000.N06", "start": 1166043, "end": 1227776}, {"filename": "/game/CUTS/CS000.N07", "start": 1227776, "end": 1552546}, {"filename": "/game/CUTS/CS000.N10", "start": 1552546, "end": 2124761}, {"filename": "/game/CUTS/CS000.N11", "start": 2124761, "end": 2150262}, {"filename": "/game/CUTS/CS000.N12", "start": 2150262, "end": 2190634}, {"filename": "/game/CUTS/CS000.N13", "start": 2190634, "end": 2236284}, {"filename": "/game/CUTS/CS000.N14", "start": 2236284, "end": 2296412}, {"filename": "/game/CUTS/CS000.N15", "start": 2296412, "end": 2328197}, {"filename": "/game/CUTS/CS000.N16", "start": 2328197, "end": 2364567}, {"filename": "/game/CUTS/CS000.N17", "start": 2364567, "end": 2406561}, {"filename": "/game/CUTS/CS000.N20", "start": 2406561, "end": 2430802}, {"filename": "/game/CUTS/CS000.N21", "start": 2430802, "end": 2449723}, {"filename": "/game/CUTS/CS000.N22", "start": 2449723, "end": 2513836}, {"filename": "/game/CUTS/CS000.N23", "start": 2513836, "end": 2644995}, {"filename": "/game/CUTS/CS000.N24", "start": 2644995, "end": 2684471}, {"filename": "/game/CUTS/CS000.N25", "start": 2684471, "end": 2727300}, {"filename": "/game/CUTS/CS001.N00", "start": 2727300, "end": 2727946}, {"filename": "/game/CUTS/CS001.N01", "start": 2727946, "end": 2783312}, {"filename": "/game/CUTS/CS001.N02", "start": 2783312, "end": 3170058}, {"filename": "/game/CUTS/CS001.N03", "start": 3170058, "end": 3224716}, {"filename": "/game/CUTS/CS001.N04", "start": 3224716, "end": 3291794}, {"filename": "/game/CUTS/CS001.N05", "start": 3291794, "end": 3344839}, {"filename": "/game/CUTS/CS001.N06", "start": 3344839, "end": 3392935}, {"filename": "/game/CUTS/CS001.N07", "start": 3392935, "end": 3449266}, {"filename": "/game/CUTS/CS001.N10", "start": 3449266, "end": 3711310}, {"filename": "/game/CUTS/CS002.N00", "start": 3711310, "end": 3711778}, {"filename": "/game/CUTS/CS002.N01", "start": 3711778, "end": 3745775}, {"filename": "/game/CUTS/CS002.N02", "start": 3745775, "end": 3782706}, {"filename": "/game/CUTS/CS002.N03", "start": 3782706, "end": 3823064}, {"filename": "/game/CUTS/CS002.N04", "start": 3823064, "end": 3853564}, {"filename": "/game/CUTS/CS003.N00", "start": 3853564, "end": 3853680}, {"filename": "/game/CUTS/CS003.N01", "start": 3853680, "end": 3888391}, {"filename": "/game/CUTS/CS003.N02", "start": 3888391, "end": 3926720}, {"filename": "/game/CUTS/CS011.N00", "start": 3926720, "end": 3926742}, {"filename": "/game/CUTS/CS011.N01", "start": 3926742, "end": 4057306}, {"filename": "/game/CUTS/CS012.N00", "start": 4057306, "end": 4057400}, {"filename": "/game/CUTS/CS012.N01", "start": 4057400, "end": 4404473}, {"filename": "/game/CUTS/CS013.N00", "start": 4404473, "end": 4404489}, {"filename": "/game/CUTS/CS013.N01", "start": 4404489, "end": 4432960}, {"filename": "/game/CUTS/CS014.N00", "start": 4432960, "end": 4432976}, {"filename": "/game/CUTS/CS014.N01", "start": 4432976, "end": 4463225}, {"filename": "/game/CUTS/CS015.N00", "start": 4463225, "end": 4463241}, {"filename": "/game/CUTS/CS015.N01", "start": 4463241, "end": 4474576}, {"filename": "/game/CUTS/CS030.N00", "start": 4474576, "end": 4474714}, {"filename": "/game/CUTS/CS031.N00", "start": 4474714, "end": 4474912}, {"filename": "/game/CUTS/CS032.N00", "start": 4474912, "end": 4475230}, {"filename": "/game/CUTS/CS033.N00", "start": 4475230, "end": 4475428}, {"filename": "/game/CUTS/CS034.N00", "start": 4475428, "end": 4475566}, {"filename": "/game/CUTS/CS035.N00", "start": 4475566, "end": 4475764}, {"filename": "/game/CUTS/CS036.N00", "start": 4475764, "end": 4475872}, {"filename": "/game/CUTS/CS037.N00", "start": 4475872, "end": 4476010}, {"filename": "/game/CUTS/CS040.N00", "start": 4476010, "end": 4476148}, {"filename": "/game/CUTS/CS041.N00", "start": 4476148, "end": 4476286}, {"filename": "/game/CUTS/CS400.N00", "start": 4476286, "end": 4476302}, {"filename": "/game/CUTS/CS400.N01", "start": 4476302, "end": 4506755}, {"filename": "/game/CUTS/CS401.N00", "start": 4506755, "end": 4506771}, {"filename": "/game/CUTS/CS401.N01", "start": 4506771, "end": 4574165}, {"filename": "/game/CUTS/CS402.N00", "start": 4574165, "end": 4574175}, {"filename": "/game/CUTS/CS402.N01", "start": 4574175, "end": 4768707}, {"filename": "/game/CUTS/CS403.N00", "start": 4768707, "end": 4768729}, {"filename": "/game/CUTS/CS403.N01", "start": 4768729, "end": 4964465}, {"filename": "/game/CUTS/CS403.N02", "start": 4964465, "end": 4979154}, {"filename": "/game/CUTS/CS404.N00", "start": 4979154, "end": 4979174}, {"filename": "/game/CUTS/CS404.N01", "start": 4979174, "end": 5021415}, {"filename": "/game/CUTS/CS410.N00", "start": 5021415, "end": 5021425}, {"filename": "/game/CUTS/CS410.N01", "start": 5021425, "end": 5041523}, {"filename": "/game/DATA/3DWIN.GR", "start": 5041523, "end": 5041781}, {"filename": "/game/DATA/ALLPALS.DAT", "start": 5041781, "end": 5042294}, {"filename": "/game/DATA/ANIMO.GR", "start": 5042294, "end": 5046701}, {"filename": "/game/DATA/ARMOR_F.GR", "start": 5046701, "end": 5092098}, {"filename": "/game/DATA/ARMOR_M.GR", "start": 5092098, "end": 5137495}, {"filename": "/game/DATA/BABGLOBS.DAT", "start": 5137495, "end": 5137883}, {"filename": "/game/DATA/BLNKMAP.BYT", "start": 5137883, "end": 5201883}, {"filename": "/game/DATA/BODIES.GR", "start": 5201883, "end": 5226820}, {"filename": "/game/DATA/BUTTONS.GR", "start": 5226820, "end": 5234775}, {"filename": "/game/DATA/CHAINS.GR", "start": 5234775, "end": 5236686}, {"filename": "/game/DATA/CHARGEN.BYT", "start": 5236686, "end": 5300686}, {"filename": "/game/DATA/CHARHEAD.GR", "start": 5300686, "end": 5333425}, {"filename": "/game/DATA/CHRBTNS.GR", "start": 5333425, "end": 5374721}, {"filename": "/game/DATA/CHRGEN.DAT", "start": 5374721, "end": 5374959}, {"filename": "/game/DATA/CMB.DAT", "start": 5374959, "end": 5375019}, {"filename": "/game/DATA/CNV.ARK", "start": 5375019, "end": 5933026}, {"filename": "/game/DATA/COMOBJ.DAT", "start": 5933026, "end": 5938660}, {"filename": "/game/DATA/COMPASS.GR", "start": 5938660, "end": 5944506}, {"filename": "/game/DATA/CONV.BYT", "start": 5944506, "end": 6008506}, {"filename": "/game/DATA/CONVERSE.GR", "start": 6008506, "end": 6026363}, {"filename": "/game/DATA/CURSORS.GR", "start": 6026363, "end": 6028343}, {"filename": "/game/DATA/DOORS.GR", "start": 6028343, "end": 6055091}, {"filename": "/game/DATA/DRAGONS.GR", "start": 6055091, "end": 6071355}, {"filename": "/game/DATA/EYES.GR", "start": 6071355, "end": 6072052}, {"filename": "/game/DATA/F16.TR", "start": 6072052, "end": 6085580}, {"filename": "/game/DATA/F32.TR", "start": 6085580, "end": 6139044}, {"filename": "/game/DATA/FLASKS.GR", "start": 6139044, "end": 6149824}, {"filename": "/game/DATA/FONT4X5P.SYS", "start": 6149824, "end": 6150321}, {"filename": "/game/DATA/FONT5X6I.SYS", "start": 6150321, "end": 6151349}, {"filename": "/game/DATA/FONT5X6P.SYS", "start": 6151349, "end": 6152250}, {"filename": "/game/DATA/FONTBIG.SYS", "start": 6152250, "end": 6156199}, {"filename": "/game/DATA/FONTBUTN.SYS", "start": 6156199, "end": 6157433}, {"filename": "/game/DATA/FONTCHAR.SYS", "start": 6157433, "end": 6160112}, {"filename": "/game/DATA/GENHEAD.GR", "start": 6160112, "end": 6195205}, {"filename": "/game/DATA/GRAVE.DAT", "start": 6195205, "end": 6195717}, {"filename": "/game/DATA/HEADS.GR", "start": 6195717, "end": 6207374}, {"filename": "/game/DATA/INV.GR", "start": 6207374, "end": 6217023}, {"filename": "/game/DATA/LEV.ARK", "start": 6217023, "end": 6507887}, {"filename": "/game/DATA/LFTI.GR", "start": 6507887, "end": 6514268}, {"filename": "/game/DATA/LIGHT.DAT", "start": 6514268, "end": 6518364}, {"filename": "/game/DATA/LIGHTS.DAT", "start": 6518364, "end": 6518372}, {"filename": "/game/DATA/MAIN.BYT", "start": 6518372, "end": 6582372}, {"filename": "/game/DATA/MONO.DAT", "start": 6582372, "end": 6586468}, {"filename": "/game/DATA/OBJECTS.DAT", "start": 6586468, "end": 6590022}, {"filename": "/game/DATA/OBJECTS.GR", "start": 6590022, "end": 6619474}, {"filename": "/game/DATA/OPBTN.GR", "start": 6619474, "end": 6644743}, {"filename": "/game/DATA/OPSCR.BYT", "start": 6644743, "end": 6708743}, {"filename": "/game/DATA/OPTB.GR", "start": 6708743, "end": 6713603}, {"filename": "/game/DATA/OPTBTNS.GR", "start": 6713603, "end": 6761421}, {"filename": "/game/DATA/PALS.DAT", "start": 6761421, "end": 6767565}, {"filename": "/game/DATA/PANELS.GR", "start": 6767565, "end": 6796334}, {"filename": "/game/DATA/PLAYER.DAT", "start": 6796334, "end": 6796635}, {"filename": "/game/DATA/POWER.GR", "start": 6796635, "end": 6801976}, {"filename": "/game/DATA/PRES1.BYT", "start": 6801976, "end": 6865976}, {"filename": "/game/DATA/PRES2.BYT", "start": 6865976, "end": 6929976}, {"filename": "/game/DATA/QUESTION.GR", "start": 6929976, "end": 6930121}, {"filename": "/game/DATA/SCRLEDGE.GR", "start": 6930121, "end": 6932782}, {"filename": "/game/DATA/SHADES.DAT", "start": 6932782, "end": 6932878}, {"filename": "/game/DATA/SKILLS.DAT", "start": 6932878, "end": 6933065}, {"filename": "/game/DATA/SPELLS.GR", "start": 6933065, "end": 6939309}, {"filename": "/game/DATA/STRINGS.PAK", "start": 6939309, "end": 7166539}, {"filename": "/game/DATA/TERRAIN.DAT", "start": 7166539, "end": 7167563}, {"filename": "/game/DATA/TMFLAT.GR", "start": 7167563, "end": 7171810}, {"filename": "/game/DATA/TMOBJ.GR", "start": 7171810, "end": 7194687}, {"filename": "/game/DATA/UW.CFG", "start": 7194687, "end": 7194732}, {"filename": "/game/DATA/VIEWS.GR", "start": 7194732, "end": 7194823}, {"filename": "/game/DATA/W16.TR", "start": 7194823, "end": 7249431}, {"filename": "/game/DATA/W64.TR", "start": 7249431, "end": 8110439}, {"filename": "/game/DATA/WEAPONS.CM", "start": 8110439, "end": 8110471}, {"filename": "/game/DATA/WEAPONS.DAT", "start": 8110471, "end": 8110919}, {"filename": "/game/DATA/WEAPONS.GR", "start": 8110919, "end": 8181897}, {"filename": "/game/DATA/WIN1.BYT", "start": 8181897, "end": 8245897}, {"filename": "/game/DATA/WIN2.BYT", "start": 8245897, "end": 8309897}, {"filename": "/game/DATA/XFER.DAT", "start": 8309897, "end": 8311433}, {"filename": "/game/INSTALL.DAT", "start": 8311433, "end": 8312273}, {"filename": "/game/INSTALL.OLB", "start": 8312273, "end": 8342387}, {"filename": "/game/LHA.DOC", "start": 8342387, "end": 8374227}, {"filename": "/game/LHA.EXE", "start": 8374227, "end": 8400342}, {"filename": "/game/SOUND/00.VOC", "start": 8400342, "end": 8421086}, {"filename": "/game/SOUND/01.VOC", "start": 8421086, "end": 8447240}, {"filename": "/game/SOUND/02.VOC", "start": 8447240, "end": 8511642}, {"filename": "/game/SOUND/03.VOC", "start": 8511642, "end": 8586899}, {"filename": "/game/SOUND/04.VOC", "start": 8586899, "end": 8637584}, {"filename": "/game/SOUND/05.VOC", "start": 8637584, "end": 8692014}, {"filename": "/game/SOUND/06.VOC", "start": 8692014, "end": 8739856}, {"filename": "/game/SOUND/07.VOC", "start": 8739856, "end": 8806121}, {"filename": "/game/SOUND/08.VOC", "start": 8806121, "end": 8858590}, {"filename": "/game/SOUND/09.VOC", "start": 8858590, "end": 8905851}, {"filename": "/game/SOUND/10.VOC", "start": 8905851, "end": 8954053}, {"filename": "/game/SOUND/11.VOC", "start": 8954053, "end": 9022535}, {"filename": "/game/SOUND/12.VOC", "start": 9022535, "end": 9053138}, {"filename": "/game/SOUND/13.VOC", "start": 9053138, "end": 9080271}, {"filename": "/game/SOUND/14.VOC", "start": 9080271, "end": 9123559}, {"filename": "/game/SOUND/15.VOC", "start": 9123559, "end": 9137372}, {"filename": "/game/SOUND/16.VOC", "start": 9137372, "end": 9186792}, {"filename": "/game/SOUND/17.VOC", "start": 9186792, "end": 9215870}, {"filename": "/game/SOUND/18.VOC", "start": 9215870, "end": 9233672}, {"filename": "/game/SOUND/19.VOC", "start": 9233672, "end": 9292866}, {"filename": "/game/SOUND/20.VOC", "start": 9292866, "end": 9349433}, {"filename": "/game/SOUND/22.VOC", "start": 9349433, "end": 9382117}, {"filename": "/game/SOUND/23.VOC", "start": 9382117, "end": 9413659}, {"filename": "/game/SOUND/24.VOC", "start": 9413659, "end": 9457541}, {"filename": "/game/SOUND/25.VOC", "start": 9457541, "end": 9490279}, {"filename": "/game/SOUND/26.VOC", "start": 9490279, "end": 9512894}, {"filename": "/game/SOUND/27.VOC", "start": 9512894, "end": 9601635}, {"filename": "/game/SOUND/28.VOC", "start": 9601635, "end": 9643856}, {"filename": "/game/SOUND/29.VOC", "start": 9643856, "end": 9685246}, {"filename": "/game/SOUND/30.VOC", "start": 9685246, "end": 9738873}, {"filename": "/game/SOUND/31.VOC", "start": 9738873, "end": 9754088}, {"filename": "/game/SOUND/32.VOC", "start": 9754088, "end": 9818752}, {"filename": "/game/SOUND/33.VOC", "start": 9818752, "end": 9856561}, {"filename": "/game/SOUND/34.VOC", "start": 9856561, "end": 9885621}, {"filename": "/game/SOUND/35.VOC", "start": 9885621, "end": 9913982}, {"filename": "/game/SOUND/36.VOC", "start": 9913982, "end": 9949770}, {"filename": "/game/SOUND/37.VOC", "start": 9949770, "end": 9985458}, {"filename": "/game/SOUND/38.VOC", "start": 9985458, "end": 10024253}, {"filename": "/game/SOUND/39.VOC", "start": 10024253, "end": 10067404}, {"filename": "/game/SOUND/50.VOC", "start": 10067404, "end": 10080356}, {"filename": "/game/SOUND/58.VOC", "start": 10080356, "end": 10126275}, {"filename": "/game/SOUND/65.VOC", "start": 10126275, "end": 10143569}, {"filename": "/game/SOUND/ADLIB.ADV", "start": 10143569, "end": 10159845}, {"filename": "/game/SOUND/AW01.XMI", "start": 10159845, "end": 10165789}, {"filename": "/game/SOUND/AW02.XMI", "start": 10165789, "end": 10170889}, {"filename": "/game/SOUND/AW03.XMI", "start": 10170889, "end": 10176515}, {"filename": "/game/SOUND/AW04.XMI", "start": 10176515, "end": 10180531}, {"filename": "/game/SOUND/AW05.XMI", "start": 10180531, "end": 10184203}, {"filename": "/game/SOUND/AW06.XMI", "start": 10184203, "end": 10189689}, {"filename": "/game/SOUND/AW07.XMI", "start": 10189689, "end": 10194341}, {"filename": "/game/SOUND/AW10.XMI", "start": 10194341, "end": 10197229}, {"filename": "/game/SOUND/AW11.XMI", "start": 10197229, "end": 10197663}, {"filename": "/game/SOUND/AW12.XMI", "start": 10197663, "end": 10198673}, {"filename": "/game/SOUND/AW13.XMI", "start": 10198673, "end": 10199457}, {"filename": "/game/SOUND/AW15.XMI", "start": 10199457, "end": 10201435}, {"filename": "/game/SOUND/MT32MPU.ADV", "start": 10201435, "end": 10211926}, {"filename": "/game/SOUND/PASDIG.ADV", "start": 10211926, "end": 10215978}, {"filename": "/game/SOUND/PASFM.ADV", "start": 10215978, "end": 10232730}, {"filename": "/game/SOUND/PCSPKR.ADV", "start": 10232730, "end": 10240681}, {"filename": "/game/SOUND/SBDIG.ADV", "start": 10240681, "end": 10244945}, {"filename": "/game/SOUND/SBFM.ADV", "start": 10244945, "end": 10261270}, {"filename": "/game/SOUND/SBPDIG.ADV", "start": 10261270, "end": 10265749}, {"filename": "/game/SOUND/SBPFM.ADV", "start": 10265749, "end": 10282510}, {"filename": "/game/SOUND/SOUNDS.DAT", "start": 10282510, "end": 10282631}, {"filename": "/game/SOUND/TANDY.ADV", "start": 10282631, "end": 10290852}, {"filename": "/game/SOUND/UW.AD", "start": 10290852, "end": 10299854}, {"filename": "/game/SOUND/UW.MT", "start": 10299854, "end": 10316112}, {"filename": "/game/SOUND/UW01.XMI", "start": 10316112, "end": 10321696}, {"filename": "/game/SOUND/UW02.XMI", "start": 10321696, "end": 10327944}, {"filename": "/game/SOUND/UW03.XMI", "start": 10327944, "end": 10333622}, {"filename": "/game/SOUND/UW04.XMI", "start": 10333622, "end": 10337650}, {"filename": "/game/SOUND/UW05.XMI", "start": 10337650, "end": 10341546}, {"filename": "/game/SOUND/UW06.XMI", "start": 10341546, "end": 10346668}, {"filename": "/game/SOUND/UW07.XMI", "start": 10346668, "end": 10351440}, {"filename": "/game/SOUND/UW10.XMI", "start": 10351440, "end": 10354720}, {"filename": "/game/SOUND/UW11.XMI", "start": 10354720, "end": 10355182}, {"filename": "/game/SOUND/UW12.XMI", "start": 10355182, "end": 10356234}, {"filename": "/game/SOUND/UW13.XMI", "start": 10356234, "end": 10357114}, {"filename": "/game/SOUND/UW15.XMI", "start": 10357114, "end": 10359112}, {"filename": "/game/UINSTALL.EXE", "start": 10359112, "end": 10429768}, {"filename": "/game/UW.EXE", "start": 10429768, "end": 10977016}, {"filename": "/game/UWSOUND.EXE", "start": 10977016, "end": 10998584}, {"filename": "/game/roms/cm32l_ctrl_1_02.rom", "start": 10998584, "end": 11064120}, {"filename": "/game/roms/cm32l_pcm.rom", "start": 11064120, "end": 12112696}], "remote_package_size": 12112696, "package_uuid": "sha256-eb95d1f56b5806ed52645a07f4846244e5b50c827e6b4149f748328766e8f01d"});

  })();
