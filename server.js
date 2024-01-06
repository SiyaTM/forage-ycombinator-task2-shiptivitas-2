// import express from 'express';
// import Database from 'better-sqlite3';
const express = require('express');
const Database = require('better-sqlite3');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('select * from clients').all();
  const client = clients.find(client => client.id === id);

  /* ---------- Update code below ----------*/
  if (!client) {
    return res.status(404).send({
      'message': 'Client not found.',
      'long_message': 'Cannot find client with that id.',
    });
  }

  // Store the current position and status of the client
  const currentPosition = client.position;
  const currentStatus = client.status;

  // Update the client's status if provided
  if (status && status !== currentStatus) {
    // Validate the new status
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }

    // Update the client's status and reset the priority if the status changes
    db.prepare('update clients set status = ?, priority = null where id = ?').run(status, id);
  }

  // Update the client's priority if provided
  if (priority !== undefined) {
    const validatedPriority = validatePriority(priority);

    if (!validatedPriority.valid) {
      return res.status(400).send(validatedPriority.messageObj);
    }

    // Update the priority only if it's a valid positive integer
    db.prepare('update clients set priority = ? where id = ?').run(priority, id);
  }

  // Fetch the updated clients after the changes
  clients = db.prepare('select * from clients').all();

  // Update the positions if the status or priority has changed
  if (status && status !== currentStatus) {
    clients = clients.map((c) => {
      if (c.status === currentStatus && c.position > currentPosition) {
        // Move down the clients in the same swimlane after the moved card
        c.position -= 1;
      }
      if (c.status === status && c.position >= currentPosition) {
        // Move up the clients in the same swimlane after the moved card
        c.position += 1;
      }
      return c;
    });
  } else if (priority !== undefined && priority !== client.priority) {
    // Update the positions if the priority has changed in the same swimlane
    clients = clients.map((c) => {
      if (c.status === currentStatus && c.position > currentPosition && c.priority >= priority) {
        // Move down the clients in the same swimlane with equal or higher priority
        c.position += 1;
      }
      if (c.status === currentStatus && c.position > currentPosition && c.priority < priority) {
        // Move up the clients in the same swimlane with lower priority
        c.position -= 1;
      }
      return c;
    });
  }

  // Update the positions in the database
  clients.forEach((c) => {
    db.prepare('update clients set position = ? where id = ?').run(c.position, c.id);
  });


  return res.status(200).send(clients);
});

app.listen(3001);
console.log('app running on port ', 3001);
