'use strict';

const ChainJobQueue = require('./chain-job-queue'),
  path = require('path'),
  bluebird = require('bluebird'),
  winston = require('winston'),
  fs = bluebird.promisifyAll(require('fs')),
  redis = require('redis'),
  clientRedis = redis.createClient(),
  cluster = require('cluster'),
  numberFork = require('os').cpus().length;

const logger = new (winston.Logger)({
  exitOnError: false,
  transports: [
    new (winston.transports.File)({
      name: 'sisyphe-info',
      filename: 'logs/sisyphe.log',
      level: 'info'
    }),
    new (winston.transports.File)({
      name: 'sisyphe-error',
      handleExceptions: true,
      filename: 'logs/sisyphe-error.log',
      level: 'error'
    })
  ]
});
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

class Sisyphe {
  constructor(starter, workers) {
    const defaultStarter = {
      module: "walker-fs",
      options: {
        path: path.resolve(__dirname + "/../test/dataset")
      }
    };
    this.starter = starter || defaultStarter;
    const defaultWorkers = [{
      name: "SisypheFileType",
      module: "sisyphe-filetype"
    }, {
      name: "SisypheXML",
      module: "sisyphe-xml"
    }, {
      name : "SisyphePDF",
      module: "sisyphe-pdf"
    }, {
      name : "SisypheXPATH",
      module : "sisyphe-xpath"
    }];
    this.workers = workers || defaultWorkers;
  }

  startToGenerateTask() {
    console.time('executionTime');
    clientRedis.flushall();
    return this.starterModule.start();
  }

  heartbeat() {
    const callFinishers = () => {
      return bluebird.filter(this.workflow.listWorker, (worker) => {
        return worker.features.finalJob !== undefined
      }).map((worker) => {
        return bluebird.promisify(worker.features.finalJob)();
      })
    };

    setInterval(function () {
      clientRedis.hgetallAsync('sisyphe').then((values) => {
        values.isOK = true;
        for (const prop in values) {
          if (values.hasOwnProperty(prop) && values[prop] === undefined) values.isOK = false;
        }
        const totalJobs = +[values.totalPerformedTask] + +[values.totalFailedTask];
        if (values.isOK && totalJobs >= +values.totalGeneratedTask) {
          clearInterval(this);
          logger.info("Total jobs created = " + +[values.totalGeneratedTask]);
          logger.info("Total jobs completed = " + +[values.totalPerformedTask]);
          logger.info("Total jobs failed = " + +[values.totalFailedTask]);
          logger.info("Total jobs = " + totalJobs);
          logger.info('release finishers !');
          callFinishers().then(() => {
            logger.info('All finalJob executed !');
            clientRedis.del('sisyphe');
            console.log('');
            console.log('This is the end !');
            console.timeEnd('executionTime');
          }).catch((error) => {
            // TODO : rajouter une gestion des erreur pour les logs
            logger.error(error);
          });
        }
      }).catch((error) => {
        logger.error(error)
      });
    }, 2000);
  }

  start() {
    this.initializeWorker().then(() => {
      if (cluster.isMaster) {
        for (let i = 0; i < numberFork; i++) {
          const fork = cluster.fork();
          fork.on('online', () => {
            logger.info('fork created');
          });
          fork.on('exit', () => {
            cluster.fork();
            logger.info('fork exit');
          });
        }
        // this.heartbeat();
        this.initializeStarter()
          .then(() => this.startToGenerateTask())
          .then(() => this.heartbeat());
      } else {
        this.activateWorker();
      }
    });
  }

  initializeWorker() {
    const workerDirectory = path.resolve(__dirname + "/../worker");
    this.workflow = new ChainJobQueue();

    return bluebird.map(this.workers, (worker) => {
      return fs.accessAsync(workerDirectory + "/" + worker.module)
    }).then(() => {
      return this.workers.map((worker) => {
        const pathToWorkerModule = workerDirectory + "/" + worker.module;
        const workerModule = require(pathToWorkerModule);
        const packageWorkerModule = require(pathToWorkerModule + '/package.json');
        return {
          name: packageWorkerModule.name,
          obj: workerModule,
          options: worker.options
        };
      })
    }).then((arrayWorkerModule) => {
      arrayWorkerModule.map((workerModule) => {
        this.workflow.addWorker(workerModule.name, workerModule.obj, workerModule.options);
      });
      this.workflow.createQueueForWorkers();
      return this;
    });
  }

  activateWorker() {
    this.workflow.initializeFeaturesWorkers().addJobProcessToWorkers();
    return this;
  }

  initializeStarter() {
    const starterDirectory = path.resolve(__dirname + "/../starter");
    const pathToStarterModule = starterDirectory + "/" + this.starter.module;
    return fs.accessAsync(pathToStarterModule).then(() => {
      const StarterModule = require(starterDirectory + "/" + this.starter.module);
      this.starterModule = new StarterModule(this.starter.options);

      this.starterModule.setFunctionEventOnData((data) => {
        this.starterModule.totalFile++;
        this.workflow.addTask(data);
      });

      this.starterModule.setFunctionEventOnEnd(() => {
        this.workflow.totalGeneratedTask = this.starterModule.totalFile;
        clientRedis.hset('sisyphe', 'totalGeneratedTask', this.starterModule.totalFile);
        logger.info('Total jobs generated by starter module = ' + this.starterModule.totalFile);
      });

      return this;
    });
  }
}

module.exports = Sisyphe;
