var sinker = require('../');
var net = require('net');
var minimist = require('minimist');
var argv = minimist(process.argv.slice(2));

var dir = argv._[0];

var server = net.createServer(function (stream) {
    var sink = sinker(dir);
    sink.pipe(stream).pipe(sink);
});
server.listen(5000);
