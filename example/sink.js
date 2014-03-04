var sinker = require('../');
var minimist = require('minimist');
var argv = minimist(process.argv.slice(2));

var dir = argv._[0];
var sink = sinker(dir);
sink.pipe(process.stdout);
