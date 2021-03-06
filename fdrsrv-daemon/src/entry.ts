/**
 * Module dependencies.
 */

import * as http from 'http';
import app from './app';

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val: string): any {
  const port = parseInt(val, 10);

  // eslint-disable-next-line
  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

const debug = require('debug')('static-docker-registry-server:server');

/**
 * Get port from environment and store in Express.
 */

const port = normalizePort(process.env.PORT || '33000');
const host = process.env.HOST;
if (host) {
  app.set('host', host);
}
app.set('port', port);

/**
 * Create HTTP server.
 */

const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port, host);

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error: any) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string'
    ? `Pipe ${port}`
    : `Port ${port}`;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string'
    ? `pipe ${addr}`
    : `port ${addr.port}`;
  debug(`Listening on ${bind}`);
}

server.on('error', onError);
server.on('listening', onListening);
