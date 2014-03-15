var sinker = require('../');
var net = require('net');

var sink = sinker(process.argv[2]);
sink.pipe(net.connect(5000)).pipe(sink);
