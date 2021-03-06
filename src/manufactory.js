const Dispatcher = require('./dispatcher');
const Overseer = require('./overseer');
const Task = require('./task');
const Promise = require('bluebird');
const os = require('os');

/**
 * Manage all Dispatchers. When a Dispatcher is finished, the next one is called
 * @constructor
 */
const Manufactory = {};

/**
 * @param {Object} options Options for dispatcher
 * @param {String} options.corpusName Corpus name
 * @param {String} options.configDir Path to config
 * @param {Number} options.numCPUs Number of cpu to use
 * @param {Number} options.now Session start
 * @param {String} options.outputPath Where to put results
 * @returns {Manufactory}
 */
Manufactory.init = function (
  options = { inputPath: '.', numCPUs: os.cpus().length, debugMod: false }
) {
  this.workers = [];
  this.options = options;
  this.pathToAnalyze = options.inputPath;
  this.numCPUs = options.numCPUs;
  this.firstStart = true;
  this.nbFiles = 0;
  this.bundle = options.bundle ? options.bundle : Infinity;
  return this;
};

/**
 * Add name of the worker to the list of workers
 * @param {String} worker Name of a Worker
 * @return {Manufactory}
 */
Manufactory.addWorker = function (worker) {
  this.workers.push(worker);
  return this;
};

/**
 * Initialize all dispatcher and put Overseers in it
 * @returns {Promise}
 */
Manufactory.initializeWorkers = function () {
  return this.createDispatchers().createOverseersForDispatchers().then(() => {
    return this.bindDispatchers();
  });
};

/**
 * Launch final job on all workers
 */
Manufactory.final = function () {
  return Promise.map(this.dispatchers, dispatcher => {
    return dispatcher.patients[0].final();
  });
};

/**
 * Launch the first Dispatcher and the other after the end of each
 * @returns {Promise}
 */
let saveFiles = [];
let saveDirectories = [];
Manufactory.start = function () {
  let filesInBundle = 0;
  let walkerfs = this.dispatchers[0];
  let secondWorker = this.dispatchers[1];
  return new Promise(async (resolve, reject) => {
    if (this.firstStart) {
      await walkerfs.tasks.add({ directory: this.pathToAnalyze });
      walkerfs.on('result', async msg => {
        let files = msg.data.files;
        const directories = msg.data.directories;
        if (filesInBundle + files.length <= this.bundle) {
          filesInBundle += +files.length;
          await addFiles(files);
          await addDirectories(directories);
        } else {
          const complement = this.bundle - filesInBundle;
          filesInBundle = this.bundle;
          await addFiles(files.splice(0, complement));
          saveDirectories.push(...directories);
          saveFiles.push(...files);
        }
      });
    }

    if (saveFiles.length >= this.bundle) await addFiles(saveFiles.splice(0, this.bundle));
    else {
      await addDirectories(saveDirectories);
      await addFiles(saveFiles);
      saveDirectories = [];
      saveFiles = [];
    }
    if ((await walkerfs.tasks.getWaiting()).length) await walkerfs.start();
    return Promise.each(this.dispatchers, async (dispatcher, index) => {
      if (index === 0) return;
      return dispatcher.start();
    }).then(async _ => {
      this.firstStart = false;
      this.filesInBundle = 0;
      if (saveFiles.length || saveDirectories.length || await (walkerfs.tasks.getWaiting().length)) return this.start();
    }).then(_ => {
      return resolve();
    }).catch(err => reject(err));
    function addFiles (files) {
      return Promise.map(files, file => secondWorker.tasks.add(file));
    }
    function addDirectories (directories) {
      return Promise.map(directories, directory => walkerfs.tasks.add({directory}));
    }
  });
};
/**
 * Create a Dispatchers, Tasks and bind them
 * @returns {Manufactory}
 */
Manufactory.createDispatchers = function () {
  this.dispatchers = this.workers.map(worker => {
    const task = Object.create(Task);
    task.init({ name: worker });
    const dispatcher = Object.create(Dispatcher);
    dispatcher.init(task, {
      name: worker
    });
    return dispatcher;
  });
  return this;
};

/**
 * For each Dispatcher, we create the number of CPU of Overseers
 * @returns {Promise}
 */
Manufactory.createOverseersForDispatchers = function () {
  let nb = 0;
  return Promise.map(this.dispatchers, dispatcher => {
    return Promise.map(Array.from(Array(this.numCPUs).keys()), numero => {
      nb++;
      const overseer = Object.create(Overseer);
      return overseer
        .init(dispatcher.options.name, this.options, nb)
        .then(overseer => {
          dispatcher.addPatient(overseer);
          return overseer;
        });
    });
  });
};

/**
 * Bind events to Dispatchers and manage the loop of the walker-fs
 * @returns {Manufactory}
 */
Manufactory.bindDispatchers = function () {
  this.dispatchers.map((dispatcher, index, array) => {
    if (index === 0) return;
    const isLastDispatcher = array.length === index + 1;
    if (isLastDispatcher) return;
    dispatcher.on('result', msg => {
      this.dispatchers[index + 1].tasks.add(msg.data);
    });
  });
  return this;
};

/**
 * Exit all dispatcher
 * @returns {Manufactory}
 */
Manufactory.exit = function () {
  return Promise.map(this.dispatchers, dispatcher => {
    return dispatcher.exitWithoutResurrect();
  });
};

module.exports = Manufactory;
