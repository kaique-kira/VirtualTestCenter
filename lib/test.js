
const  _ = require("lodash");
const Net = require("net");

var reqIdx = 0;

var requests = [
  [
    // MTI
    "0800",
    // BMP,
    "2238000000410008",
    //003
    "910000",
    //007
    utcDateTime,
    //011
    nsu,
    //012
    localTime,
    //013
    localDate,
    //042
    estab,
    //048
    lllvar("00100800000000"),
    //061
    lllvar("001008BS0100PH")
  ],
  [
  // MTI
  "0200",
  // BMP,
  "B238060020C182080000000000000004",
  //003
  "003000",
  //004,
  "000000008000",
  //007
  utcDateTime,
  //011
  nsu,
  //012
  localTime,
  //013
  localDate,
  //042
  "051003335413330000000000=2512601079360805BW00023501700550816600104700300201005033286C8665E330C9ED8DBCFF83FACFD835C986368FF20B5820230009F2701809F26089FF201B9ED7D335A9F36020401950500000080009F34034103029F37040E7EF9F99F3303E0F0C85F280200569F10120210A5800F040000000000000000000000FF9A031710199F1A0200769F3501229C01008407A00000000410109F02060000000080005F2A0209869F01060000000000009F4005F900F0A0019F3A04000000009F120A4D617374657243617264500A4D4153544552434152449F5301529F090200029F410400000034102001008PHBS010200202068032615            00302600000000008000760058000000004016001.15          0050020101900300120050060     "
]
];

function utcDateTime () {
  var instant = new Date();
  return pad0(instant.getMonth() + 1, 2) +
         pad0(instant.getDate(), 2) +
         pad0(instant.getHours(), 2) +
         pad0(instant.getMinutes(), 2) +
         pad0(instant.getSeconds(), 2);
}

function localTime () {
  var instant = new Date();
  return pad0(instant.getHours(), 2) +
         pad0(instant.getMinutes(), 2) +
         pad0(instant.getSeconds(), 2);
}

function localDate () {
  var instant = new Date();
  return pad0(instant.getMonth() + 1, 2) +
         pad0(instant.getDate(), 2);
}

var seq = 130003;
function nsu () {
  return pad0(seq++, 6);
}

var eIdx = 0;
var estabs = ["017005508165001", "017005508166001", "017005508167001"];
function estab () {
  if (eIdx >= estabs.length) eIdx = 0;
  return estabs[eIdx++];
}

function pad0 (value, n) {
  var result = "", c = n;
  while (c--) result += "0";
  result += value;
  return result.slice(-n);
}

function lllvar (value) {
  function eval () {
    if (_.isFunction(value)) return value();
    return value;
  }
  return pad0(value.length, 3) + eval();
}

function send (request, finish) {
  var data = "";

  var thisSeq = seq;

  _.forEach(request, (chunk) => {
    if (_.isString(chunk)) data += chunk;
    else data += chunk();
  });

  var mliSize = 2;
  var encoding = "ascii";
  var host = "192.168.1.135";
  var port = 15631;

  var start = null;

  var client = Net.createConnection(port, host, () => {

    console.log(thisSeq + " Request:  " + data);

    var buff = Buffer.alloc(mliSize + data.length);
    buff.writeUIntBE(data.length, 0, mliSize);
    buff.write(data, mliSize, encoding);
    client.write(buff);

    start = Date.now();
  });

  client.on("data", (data) => {
    var response = data.toString(encoding, mliSize);
    console.log(thisSeq + " Response: " + response);
    console.log(thisSeq + " Response " + (Date.now() - start) + " ms.")
    client.end();
    finish();
  });

  client.on("close", () => {
    console.log(thisSeq + " Close");
    clearTimeout(timeout);
  });

  client.on("end", () => {
    console.log(thisSeq + " End");
  });

  var timeout = setTimeout(() => {
    console.log(thisSeq + " Timeout");
    client.end();
  }, 30000);
}

function next () {
  if (reqIdx >= requests.length) reqIdx = 0;
  setTimeout(() => {
    send(requests[reqIdx++], next);
  }, 5000);
}

next();
