// Lo que ve un utilityProcess. Solo responde sí o no: nunca valores del entorno.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- corre como CommonJS, sin build
const electron = require('electron');
process.parentPort.postMessage({
  centinela: process.env.CENTINELA_DEL_PRINCIPAL !== undefined,
  soloEsta: process.env.SOLO_ESTA === '1',
  // Por esto el test estático prohíbe `electron.net` en el runner: un agente de Node no lo ve.
  tieneRedElectron: typeof electron.net === 'object',
});
