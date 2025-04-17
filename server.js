const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const mongoose = require('mongoose');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ---------------------------
// Middleware
// ---------------------------
app.use(express.json());
app.use(cors());

// ---------------------------
// Connect to MongoDB
// ---------------------------
mongoose.connect(
  'mongodb+srv://admarketing:Marketing%40123@cluster0.u9gvd6c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  { useNewUrlParser: true, useUnifiedTopology: true }
);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => console.log('MongoDB connected'));

// ---------------------------
// Mongoose Schema and Model for Chat Sessions
// ---------------------------
const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

// ---------------------------
// Mongoose Schema and Model for Chat Messages
// ---------------------------
const messageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  sender: { type: String, required: true },
  text: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  fileType: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// ---------------------------
// Mongoose Schema and Model for Users
// ---------------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  companyName: { type: String, required: true },
  link: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// ---------------------------
// File Upload Setup with Multer
// ---------------------------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 }, // Limit file size to 100 KB.
  fileFilter: (req, file, cb) => {
    // Accept only images and audio files.
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only images and audio files are allowed.'));
    }
  }
});

// Endpoint for file uploads.
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided or file too large.' });
  }
  // Return a URL that the frontend can use to load the file.
  const fileUrl = `http://localhost:5002/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// Serve static files from the uploads directory.
app.use('/uploads', express.static('uploads'));

// ---------------------------
// Chat Session API Endpoints
// ---------------------------

// Create a new chat session and save it in the database.
app.post('/api/create-chat', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const newSession = new ChatSession({ sessionId });
    await newSession.save();
    res.json({ sessionId });
  } catch (error) {
    console.error('Error creating chat session:', error);
    res.status(500).json({ error: 'Could not create chat session' });
  }
});

// GET endpoint to fetch all chat sessions.
app.get('/api/chat-sessions', async (req, res) => {
  try {
    const sessions = await ChatSession.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    res.status(500).json({ error: 'Could not fetch chat sessions' });
  }
});

// GET endpoint to fetch messages for a given chat session.
app.get('/api/messages/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await Message.find({ sessionId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ---------------------------
// User API Endpoints
// ---------------------------

// Create a new user.
app.post('/api/create-user', async (req, res) => {
  try {
    const { name, email, companyName } = req.body;
    // Generate a unique link for the user (adjust as needed).
    const link = `http://localhost:3000/chat/${uuidv4()}`;
    const newUser = new User({ name, email, companyName, link });
    await newUser.save();
    res.json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Could not create user' });
  }
});

// GET endpoint to fetch all users.
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Could not fetch users' });
  }
});

// ---------------------------
// Socket.IO Configuration for Real-Time Chat
// ---------------------------
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('joinSession', (sessionId) => {
    socket.join(sessionId);
    console.log(`Client joined session: ${sessionId}`);
  });
  
  socket.on('chatMessage', async ({ sessionId, sender, text, fileUrl, fileType }) => {
    const messageData = { sessionId, sender, text, fileUrl, fileType };
    // Save the message to MongoDB.
    const newMessage = new Message(messageData);
    try {
      await newMessage.save();
    } catch (error) {
      console.error('Error saving message:', error);
    }
    // Emit the message to all clients in the session.
    io.to(sessionId).emit('chatMessage', messageData);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});
// in your server.js (or routes file)
app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});


// ---------------------------
// Start the Server
// ---------------------------
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
