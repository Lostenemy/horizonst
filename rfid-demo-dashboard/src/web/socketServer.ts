import { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '../config.js';
import { buildDashboardInitial } from '../services/dashboardStateService.js';
import { logger } from '../logger.js';

export const createSocketServer = (httpServer: HttpServer): SocketIOServer => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.app.corsOrigin
    }
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    buildDashboardInitial()
      .then((snapshot) => {
        socket.emit('dashboard:init', snapshot);
      })
      .catch((error) => {
        logger.error('Failed to build initial snapshot for socket', { err: String(error) });
      });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { socketId: socket.id });
    });
  });

  return io;
};
