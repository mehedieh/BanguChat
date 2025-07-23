//
// STEP 1: FIREBASE CONFIGURATION & INITIALIZATION
//
const firebaseConfig = {
    apiKey: "AIzaSyCqsB2fxyc2ZSXJ5k-4zRBtGRfWA13eJmI",
    authDomain: "banguchat.firebaseapp.com",
    projectId: "banguchat",
    storageBucket: "banguchat.firebasestorage.app",
    messagingSenderId: "402273986567",
    appId: "1:402273986567:web:e092bedced2d0ef94362a2",
    measurementId: "G-TTKDZYCT23"
  };

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

//
// STEP 2: DOM ELEMENTS & STATE VARIABLES
//
const interestSelectionDiv = document.getElementById('interest-selection-container');
const findChatBtn = document.getElementById('find-chat-btn');
// ... other DOM elements ...
const chatContainerDiv = document.getElementById('chat-container');
const leaveChatBtn = document.getElementById('leave-chat-btn');
const userPresenceDiv = document.getElementById('user-presence');
const typingIndicatorDiv = document.getElementById('typing-indicator');

let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let userName = 'User' + Math.floor(Math.random() * 1000); // Simple username
let chatRoomId = null;
let chatUsers = {}; // Will store user data for the room
let typingTimeout;

//
// STEP 3: INTEREST SELECTION & MATCHING (largely unchanged)
//
// ... (Your existing interest selection and findOrCreateChat logic) ...
// ADDITION: Store username in lobby
await myLobbyRef.set({ 
    interests: selectedInterests, 
    username: userName, 
    timestamp: firebase.database.ServerValue.TIMESTAMP 
});

//
// STEP 4: CHAT ROOM MANAGEMENT
//
async function startChat() {
    interestSelectionDiv.classList.add('hidden');
    chatContainerDiv.classList.remove('hidden');

    const chatRoomRef = database.ref(`chatRooms/${chatRoomId}`);
    
    // Get user info and set presence
    const usersSnapshot = await chatRoomRef.child('users').get();
    chatUsers = usersSnapshot.val();
    updatePresenceUI();

    listenForMessages();
    listenForTyping();
    listenForUserLeave();

    // Set my presence
    const myPresenceRef = database.ref(`.info/connected`);
    const userStatusRef = database.ref(`chatRooms/${chatRoomId}/presence/${userId}`);
    myPresenceRef.on('value', (snap) => {
        if (snap.val() === true) {
            userStatusRef.set(true);
            userStatusRef.onDisconnect().remove();
        }
    });
}

function listenForMessages() {
    const messagesRef = database.ref(`messages/${chatRoomId}`);
    messagesRef.on('child_added', snapshot => {
        displayMessage(snapshot.key, snapshot.val());
    });
}

leaveChatBtn.addEventListener('click', () => {
    if (chatRoomId) {
        database.ref(`chatRooms/${chatRoomId}`).remove();
        database.ref(`messages/${chatRoomId}`).remove();
        window.location.reload(); // Simple way to reset state
    }
});

function listenForUserLeave() {
    database.ref(`chatRooms/${chatRoomId}`).on('value', (snap) => {
        if (!snap.exists()) {
            alert('The chat room has been closed.');
            window.location.reload();
        }
    });
}

//
// STEP 5: NEW FEATURES - TYPING INDICATOR & PRESENCE
//
function listenForTyping() {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing`);
    typingRef.on('value', snap => {
        const typingUsers = snap.val() || {};
        delete typingUsers[userId]; // Ignore self
        const names = Object.values(typingUsers);
        
        if (names.length > 0) {
            typingIndicatorDiv.textContent = `${names.join(', ')} is typing...`;
        } else {
            typingIndicatorDiv.textContent = '';
        }
    });
}

messageInput.addEventListener('input', () => {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing/${userId}`);
    typingRef.set(userName);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typingRef.remove();
    }, 2000); // User is "not typing" after 2 seconds of inactivity
});

function updatePresenceUI() {
    userPresenceDiv.innerHTML = '';
    const userCount = Object.keys(chatUsers).length;
    const presenceEl = document.createElement('div');
    presenceEl.className = 'presence-indicator';
    presenceEl.textContent = `${userCount} Users Online`;
    userPresenceDiv.appendChild(presenceEl);
}

//
// STEP 6: ENHANCED MESSAGE DISPLAY
//
const userColors = {};
function getUserAvatar(uid, uname) {
    if (!userColors[uid]) {
        const colors = ['#3700B3', '#00796B', '#C2185B', '#F57C00', '#512DA8'];
        userColors[uid] = colors[Math.floor(Math.random() * colors.length)];
    }
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.backgroundColor = userColors[uid];
    avatar.textContent = uname.charAt(0).toUpperCase();
    return avatar;
}

function displayMessage(msgId, message) {
    const msgGroup = document.createElement('div');
    msgGroup.className = 'message-group';
    msgGroup.id = msgId;

    const msgContent = document.createElement('div');
    msgContent.className = 'message-content';
    
    const msgText = document.createElement('p');
    msgText.className = 'message-text';
    msgText.textContent = message.text;

    const msgTime = document.createElement('p');
    msgTime.className = 'message-time';
    msgTime.textContent = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgContent.appendChild(msgText);
    msgContent.appendChild(msgTime);

    if (message.senderId === userId) {
        msgGroup.classList.add('sent');
    } else {
        msgGroup.classList.add('received');
        const avatar = getUserAvatar(message.senderId, message.username);
        msgGroup.appendChild(avatar);
    }
    
    msgGroup.appendChild(msgContent);
    chatMessagesDiv.appendChild(msgGroup);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

    // Disappearing message logic
    setTimeout(() => {
        const elToRemove = document.getElementById(msgId);
        if (elToRemove) {
            elToRemove.remove();
        }
        // To remove from DB as well (requires a Cloud Function for security in prod)
        // database.ref(`messages/${chatRoomId}/${msgId}`).remove();
    }, 60000); 
}

//
// STEP 7: SEND MESSAGE (UPDATED)
//
function sendMessage() {
    const text = messageInput.value.trim();
    if (text === '') return;

    const message = {
        senderId: userId,
        username: userName, // Add username to message payload
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`messages/${chatRoomId}`).push(message);
    database.ref(`chatRooms/${chatRoomId}/typing/${userId}`).remove(); // Stop typing indicator
    messageInput.value = '';
}

// Event Listeners (ensure sendBtn is correctly referenced)
const sendBtn = document.getElementById('send-btn');
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') sendMessage(); });