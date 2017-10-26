const cp = require('child_process');
var express = require('express');
var serveStatic = require('serve-static');
const path = require('path');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
var bodyParser = require('body-parser');
const { spawn } = require('child_process');
let sisyphe = null;
var app = express();
app.use(serveStatic(path.join(__dirname, 'out')));
app.use(bodyParser.json());

app.get("/workers", function(req, res) {
  const workers = require("./src/worker.json");
  res.json(workers);
});


app.get("/sisypheVersions", function(req, res) {
  const listWorkers = require('./src/worker.json').workers
  const modulesVersion = listWorkers.map(name=>{
    return {
      name,
      version: require('./src/worker/' + name + '/package.json').version
    }
  })
  res.status(200).json({
    version: require('./package').version,
    modules: modulesVersion
  })
});
cp.exec('git status', (error,stderr,stdout)=>{
  console.log(error,stdout,stderr)
})

app.get("/branches", function(req, res) {
  cp.exec("git branch", (error, stdout, stderr) => {
    const result = {};
    result.branches = stdout
      .split("\n")
      .map(branch => {
        if (branch.charAt(0) == "*"){
          branch = branch.split(" ")[1];
          result.currentBranch = branch
        }
        return branch.trim();
      })
      .filter(branch => branch !== "");
    res.json(result);
  });
});


app.post("/changeBranch", function(req, res) {
  cp.exec("git checkout " + req.body.branch.trim(), (error, stdout, stderr) => {
    if (error) res.status(500).json(error);
    else if (stderr) res.status(500).json(stderr);
    else if (stdout) res.status(200).json(stdout);
  });
});
app.post("/pull", function(req, res) {
  cp.exec("git pull", (error, stdout, stderr) => {
    if (error) res.status(500).json(error);
    else if (stderr) res.status(500).json(stderr);
    else if (stdout) res.status(200).json(stdout);
  });
});
app.get("/branchStatus", function(req, res) {
  cp.exec("git status", (error, stdout, stderr) => {
    res.json(stdout);
  });
});

app.get('/download/latest', async function (req, res) {
  const sessions = await fs.readdirAsync('out');
  const session = path.resolve('out/', sessions.sort().pop());
  let sessionsFiles = getFiles(session, session.split('/').pop() + '/');
  res.send(sessionsFiles);
});
app.get('/ping', function (req, res) {
  res.send('pong');
});
app.post('/stop', function (req, res) {
  if (sisyphe) {
    sisyphe.kill('SIGTERM');
    sisyphe = null;
  }

  res.send('stop');
});
app.post('/launch', async function (req, res) {
  if (!sisyphe) {
    console.log('launch')
    const command = req.body.command;
    let commandArray = [];
    if (command.name) commandArray.push("-n",command.name)
    if (command.config) commandArray.push("-c", command.config);
    if (command.disable) command.disable.map(worker => commandArray.push('-r',worker.name))
    if (command.path) commandArray.push(command.path);
    if (!command.debug) commandArray.push('-s');
    console.log(`launch: ${commandArray}`);
    res.send(true);
    sisyphe = cp.spawn(`./app`, commandArray);
    sisyphe.stdout.pipe(process.stdout);
    sisyphe.on('exit', _=>{
      sisyphe = null
    })
  } else {
    console.log('Already launch');
    res.send(false);
  }
});
app.post('/readdir', async function (req, res) {
  fs.readdirAsync(req.body.path)
  .then(data => {
    res.send(data);
  })
  .catch(err => {
    return res.send({error: err.message});
  });
});
console.log('listen to port 3264');
app.listen(3264);

function getFiles (pathdir, parent = '', root = 'true') {
  let files = fs.readdirSync(pathdir).map(docs => {
    const absolute = path.resolve(pathdir, docs);
    if (fs.lstatSync(absolute).isDirectory()) {
      parent += path.basename(absolute) + '/';
      return getFiles(absolute, parent, false);
    }
    return { path: parent + docs };
  });
  if (root) {
    files = flatten(files);
  }
  return files;
}
function flatten (arr) {
  return arr.reduce(function (flat, toFlatten) {
    return flat.concat(
      Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten
    );
  }, []);
}
