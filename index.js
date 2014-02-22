var express = require('express'),
    http = require('http'),
    app = express(),
    WebSocketServer = require('ws').Server,
    sio = require("socket.io").listen(5001),
    stream = require('stream'),
    Readable = stream.Readable,
    Writable = stream.Writable,
    Transform = stream.Transform,
    util = require('util');

var BUFFER_LENGTH = 2048;

var SinOsc = function(freq) {
  this.phase = 0;
  this.freq = freq;
  this.mod = 0;
  this.depth = 0;
  this.samplerate = 44100;
  Readable.call(this);
};
util.inherits(SinOsc, Readable);
SinOsc.prototype._read = function(n) {
  var self = this;
  setImmediate(function() {
    self.process();
  });
};
SinOsc.prototype.process = function() {
  var self = this,
      view = new DataView(new ArrayBuffer(BUFFER_LENGTH * 4)),
      offset = 0, i, val;
  for (i = 0; i < BUFFER_LENGTH; i++) {
    val = self.generate();
    view.setFloat32(offset, val);
    offset += 4;
  }

  var buffer = new Buffer(new Uint8Array(view.buffer));
  if (this.push(buffer)) {
    setImmediate(function() {
      self.process();
    });
  }
};
SinOsc.prototype.generate = function() {
  var val = Math.sin(Math.PI * 2 * this.phase);
  var step = (this.freq + (this.mod * this.depth)) / this.samplerate;
  this.phase += step;
  return val;
};

var sine = new SinOsc(1000);
var lfo = new SinOsc(0.5);

/*
 * SynthServer
 */

var SynthServer = function() {
  var self = this;
  //Readable.call(this);
  Transform.call(this);
  // setImmediate(function() {
  //   self.process();
  // });
};
util.inherits(SynthServer, Transform);

SynthServer.prototype._transform = function(chunk, encoding, cb) {
  var self = this;
  this.push(self.process(chunk));
  cb(null);
};
SynthServer.prototype._flush = function(output, cb) {
  cb(null);
};
// SynthServer.prototype._read = function(n) {
//   var self = this;
//   setImmediate(function() {
//     self.loop();
//   });
// };
SynthServer.prototype.process = function(input) {
  var self = this,
      view = new DataView(new ArrayBuffer(BUFFER_LENGTH * 4)),
      offset = 0, i;
  for (i = 0; i < BUFFER_LENGTH; i++) {
    var val = input.readFloatLE(i);
    view.setFloat32(offset, val);
    offset += 4;
  }
  return input;//new Buffer(new Uint8Array(view.buffer));
};

/*
 * SocketWriter
 */
var SocketWriter = function(ws, opts) {
  var self = this;
  Writable.call(self, opts);
  self.sockets = [];
};
util.inherits(SocketWriter, Writable);
SocketWriter.prototype._write = function(chunk, encoding, cb) {
  var self = this;
  this.sockets.forEach(function(s) {
    s.send(chunk, {binary: true, mask: false});
  });
  setTimeout(function() {
    cb();
  }, BUFFER_LENGTH / 44100 * 1000);
};
SocketWriter.prototype.add = function(ws) {
  this.sockets.push(ws);
  console.log("SocketWriter::add", "current conections:", this.sockets.length);
};
SocketWriter.prototype.remove = function(ws) {
  this.sockets.forEach(function(s, i, l) {
    if (s === ws) l.splice(i, 1);
  });
  console.log("SocketWriter::remove", "current conections:", this.sockets.length);
};
SocketWriter.prototype.sendMessage = function(json, src) {
  this.sockets.forEach(function(s) {
    if (src !== s) {
      s.send(JSON.stringify(json));
    }
  });
};

var synth = new SynthServer();

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});
app.configure('production', function(){
  app.use(express.errorHandler());
});
app.get('/', function(req, res){
  res.render('index');
});

var server = http.createServer(app);
var socket = new WebSocketServer({server:server, path:'/socket'});

var writer = new SocketWriter();
sine.pipe(synth).pipe(writer);

socket.on('connection', function(ws) {
  console.log('connect!!');
  writer.add(ws);

  ws.send(JSON.stringify({message: "freq", value: sine.freq}));
  ws.send(JSON.stringify({message: "lfo", value: lfo.freq}));
  ws.send(JSON.stringify({message: "depth", value: sine.depth}));
  ws.on('message', function(req, flags) {
    if (!flags.binary) {
      var data = JSON.parse(req),
          message = data.message,
          value = data.value,
          send = {};
      if (message === 'freq') {
        var freq = data.value;
        sine.freq = freq;
      } else if (message === 'lfo') {
        var freq = data.value;
        lfo.freq = freq;
      } else if (message === 'depth') {
        var depth = data.value;
        sine.depth = depth;
      }
      writer.sendMessage(data, ws);
    }
  });

  ws.on('close', function() {
    console.log('close');
    writer.remove(ws);
  });

  ws.on('e', function(e) {
    console.log('error:', e);
  });
});

var port = process.env.PORT || 5000;
server.listen(port, function() {
  console.log("Listening on " + port);
});

