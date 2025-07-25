
var Status = {
  SUCCESS: 0,
  ERROR: -1,
  NOT_FOUND: -2,
  INVALID_LOGIN: -3,
  DENIED: -4,
  VOID: -5,
  TIMEOUT: -98,
  CONN_FAILURE: -99
};

var Ws = {};

if (typeof exports != "undefined") {
  Ws = exports;
}
if (typeof window != "undefined") {
  window.Ws = Ws;
}

Ws.Status = Status;
