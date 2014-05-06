# sinker

synchronize remote directories

[![build status](https://secure.travis-ci.org/substack/sinker.png)](http://travis-ci.org/substack/sinker)

# example

server:

``` js
var sinker = require('sinker');
var net = require('net');
var dir = process.argv[2];

var server = net.createServer(function (stream) {
    var sink = sinker(dir);
    sink.pipe(stream).pipe(sink);
});
server.listen(5000);
```

client:

``` js
var sinker = require('sinker');
var net = require('net');

var sink = sinker(process.argv[2]);
sink.pipe(net.connect(5000)).pipe(sink);
```

Now modify the files from the directory given by `process.argv[2]` on either
system. The files are in sync! After the initial file exchange, each side
watches the local set of files for changes and propagates any updates to the
other end of the connection.

# methods

``` js
var sinker = require('sinker')
```

## var sink = sinker(dir, opts)

Create a duplex `sink` stream that synchronizes a directory `dir` with a remote
directory.

* `opts.write` - when `false`, don't write to any local files. This is "push"
mode.
* `opts.watch` - when `false`, don't watch the file system for changes after the
initial synchronization exchange
* `opts.fs` - pass in a custom [fs](http://nodejs.org/docs/latest/api/fs.html)
implementation. Otherwise the core node fs will be used.
* `opts.tmpdir` - use a custom tmpdir for storing files. Otherwise `os.tmpdir()`
is used.

# events

## sink.on('sync', function () {})

When the initial synchronization is complete and the files on the local and
remote are in sync, this event fires.

## sink.on('stream', function (stream) {})

Each time the remote sends a file, this event fires with the `stream` of the
contents.

The `stream.meta` is the sequence number of the initiating request.

## sink.on('ops', function (ops) {})

During initial synchronization, an `ops` list will be generated with operations
to perform.

# todo

* intelligent transfers for files with hash mismatches using the rsync algorithm
* faster multiplexer better for binary
* pluggable multiplexer for pipelined transports like http

# install

With [npm](https://npmjs.org) do:

```
npm install sinker
```

# license

MIT
