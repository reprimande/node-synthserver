var express = require('express'),
    http = require('http'),
    app = express(),
    WebSocketServer = require('ws').Server,
    sio = require("socket.io").listen(5001),
    stream = require('stream'),
    Readable = stream.Readable,
    Writable = stream.Writable,
    util = require('util');

var SinOsc = function(freq) {
  this.phase = 0;
  this.freq = freq;
  this.mod = 0;
  this.depth = 0;
  this.samplerate = 44100;
};
SinOsc.prototype = {
  generate: function() {
    var val = Math.sin(Math.PI * 2 * this.phase) * 0.5;
    var step = (this.freq + (this.mod * this.depth)) / this.samplerate;
    this.phase += step;
    return val;
  }
};
var sine = new SinOsc(1000);
var lfo = new SinOsc(0.5);
var SynthServer = function() {
  var self = this;
  Readable.call(this);
  setImmediate(function() {
    self.loop();
  });
};
util.inherits(SynthServer, Readable);
SynthServer.prototype._read = function(n) {
  var self = this;
  setImmediate(function() {
    self.loop();
  });
};

SynthServer.prototype.loop = function() {
  var self = this,
      bufLen = 2048,
      input = new Float32Array(bufLen),
      arrayBuffer = new ArrayBuffer(bufLen * 2 * 4),
      view = new DataView(arrayBuffer),
      offset = 0, i, j;

  for (i = 0; i < bufLen; i++) {
    sine.mod = lfo.generate();
    var val = sine.generate();
    input[i] = val;
  }

  for (i = 0; i < bufLen; i++) {
    view.setFloat32(offset, input[i]);
    offset += 4;
  }

  if (this.push(new Buffer(new Uint8Array(view.buffer)))) {
  //if (this.push(buf)) {
    setImmediate(function() {
      self.loop();
    });
  }
};

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
  }, 2048 / 44100 * 1000);
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
synth.pipe(writer);

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

