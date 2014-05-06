#!/usr/bin/env node

var sinker = require('../');
var net = require('net');
var minimist = require('minimist');
var argv = minimist(process.argv.slice(2), {
    alias: { v: 'verbose' }
});

if (argv.p) {
    var dir = argv.d;
    var server = net.createServer(function (stream) {
        var s = sinker(dir);
        s.on('error', function (err) {});
        stream.pipe(s).pipe(stream);
    });
    server.listen(argv.p);
}
else {
    var remote = parseTarget(argv._[0]);
    var dir = argv.d || argv._[1];
    
    var stream = net.connect(remote.port, remote.host);
    var s = sinker(dir);
    if (argv.verbose) {
        s.on('sync', function () {
            console.error('SYNC');
        });
    }
    s.on('error', function (err) { console.log(err) });
    stream.pipe(s).pipe(stream);
}

function parseTarget (x) {
    var parts = x.split(/:/);
    return {
        host: parts[0],
        port: parseInt(parts[1])
    };
}
