// server.js
'use strict';

const express    = require('express');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const mongoose   = require('mongoose');
const socketIO   = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// Environment
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT||5002}`;

// Middleware
app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(
  'mongodb+srv://admarketing:Marketing%40123@cluster0.u9gvd6c.mongodb.net/?retryWrites=true&w=majority',
  { useNewUrlParser: true, useUnifiedTopology: true, tls: true }
);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => console.log('MongoDB connected'));

// Schemas & Models
const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

const messageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  sender:    { type: String, required: true },
  text:      { type: String, default: '' },
  fileUrl:   { type: String, default: '' },
  fileType:  { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const userSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  email:       { type: String, required: true },
  companyName: { type: String, required: true },
  link:        { type: String, required: true },
  createdAt:   { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// File Upload Setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images and audio files are allowed.'));
    }
  }
});

// Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided or file too large.' });
  }
  const fileUrl = `${HOST_URL}/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});
app.use('/uploads', express.static('uploads'));

// Chat Session Endpoints
app.post('/api/create-chat', async (req, res) => {
  try {
    const sessionId = uuidv4();
    await new ChatSession({ sessionId }).save();
    res.json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create chat session' });
  }
});

app.get('/api/chat-sessions', async (req, res) => {
  try {
    const sessions = await ChatSession.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch chat sessions' });
  }
});

app.get('/api/messages/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const msgs = await Message.find({ sessionId }).sort({ createdAt: 1 });
    res.json(msgs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// User Endpoints
app.post('/api/create-user', async (req, res) => {
  try {
    const { name, email, companyName } = req.body;
    const link = `${HOST_URL}/chat/${uuidv4()}`;
    const user = await new User({ name, email, companyName, link }).save();
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create user' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch users' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Socket.IO Real-time Chat
io.on('connection', socket => {
  console.log('New client connected');

  socket.on('joinSession', sessionId => {
    socket.join(sessionId);
  });

  socket.on('chatMessage', async data => {
    const msg = new Message({ ...data, createdAt: data.createdAt || Date.now() });
    await msg.save().catch(console.error);
    io.to(data.sessionId).emit('chatMessage', data);
  });

  socket.on('disconnect', () => console.log('Client disconnected'));
});

// Serve React Frontend
app.use(
  express.static(
    path.join(__dirname, 'realtime-chat-frontend', 'build')
  )
);

app.get('*', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'realtime-chat-frontend', 'build', 'index.html')
  );
});

// Start the Server
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
