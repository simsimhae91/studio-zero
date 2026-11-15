// An app that decides itself where it keeps its data, as real ones do: a switch on the command line does not
// move it. PROBE_DATA is its own way of being pointed elsewhere.
const { app } = require('electron');
const path = require('node:path');
app.setPath('userData', process.env.PROBE_DATA || path.join(app.getPath('appData'), 'ProbeOwnData'));
require('../electron-app/main.js');
