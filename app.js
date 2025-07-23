//
// STEP 1: FIREBASE CONFIGURATION & INITIALIZATION
//
// =================== IMPORTANT ===================
//      REPLACE THIS WITH YOUR OWN FIREBASE CONFIG
// ===============================================
const firebaseConfig = {
    apiKey: "AIzaSyCqsB2fxyc2ZSXJ5k-4zRBtGRfWA13eJmI",
    authDomain: "banguchat.firebaseapp.com",
    projectId: "banguchat",
    storageBucket: "banguchat.firebasestorage.app",
    messagingSenderId: "402273986567",
    appId: "1:402273986567:web:e092bedced2d0ef94362a2",
    measurementId: "G-TTKDZYCT23"
  };

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

//
// STEP 2: DOM ELEMENT REFERENCES & GLOBAL STATE VARIABLES
//
const interestSelectionDiv = document.getElementById('interest-selection-container');
const interestsList = document.getElementById('interests-list');
const findChatBtn = document.getElementById('find-chat-btn');
const loadingIndicator = document.getElementById('loading-indicator');

const chatContainerDiv = document.getElementById('chat-container');
const chatMessagesDiv = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const leaveChatBtn = document.getElementById('leave-chat-btn');
const userPresenceDiv = document.getElementById('user-presence');
const typingIndicatorDiv = document.getElementById('typing-indicator');

let selectedInterests = [];
let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let userName = 'User' + Math.floor(Math.random() * 1000); // A simple random username
let chatRoomId = null;
let chatUsers = {}; // Stores user data for the current chat room
let typingTimeout;

//
// STEP 3: INTEREST SELECTION LOGIC
//
interestsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('interest-btn')) {
        const interest = e.target.innerText;
        e.target.classList.toggle('selected');
        if (selectedInterests.includes(interest)) {
            selectedInterests = selectedInterests.filter(i => i !== interest);
        } else {
            selectedInterests.push(interest);
        }
    }
});

findChatBtn.addEventListener('click', () => {
    if (selectedInterests.length === 0) {
        alert('Please select at least one interest.');
        return;
    }
    loadingIndicator.classList.remove('hidden');
    findChatBtn.disabled = true;
    // Call the async function that will handle finding a chat
    findOrCreateChat();
});

//
// STEP 4: USER MATCHING LOGIC (Correctly using async/await)
//
async function findOrCreateChat() {
    const lobbyRef = database.ref('lobby');
    const myLobbyRef = lobbyRef.child(userId);

    // The 'await' keyword is now correctly inside an 'async' function.
    await myLobbyRef.set({
        interests: selectedInterests,
        username: userName,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Clean up from the lobby if the user closes the tab before being matched
    myLobbyRef.onDisconnect().remove();

    // Listen for changes in the lobby to find partners
    lobbyRef.on('value', snapshot => {
        // Stop listening if we've already found and been assigned a room
        if (chatRoomId) {
            lobbyRef.off(); // Detach the listener to prevent it from running again
            return;
        }

        const lobbyUsers = snapshot.val();
        if (!lobbyUsers) return;

        // Find potential partners: users who are not me and share at least one interest
        const potentialPartners = Object.entries(lobbyUsers).filter(([id, data]) => {
            return id !== userId && data.interests.some(interest => selectedInterests.includes(interest));
        });

        // If we have found at least 2 partners, we can form a group of 3
        if (potentialPartners.length >= 2) {
            // Immediately detach the listener to prevent this user from accidentally creating multiple rooms
            lobbyRef.off();

            const partner1 = potentialPartners[0];
            const partner2 = potentialPartners[1];

            // Create a unique chat room ID for the three matched users
            chatRoomId = 'chat_' + userId;

            const chatRoomRef = database.ref('chatRooms/' + chatRoomId);

            // Create a user list for the room, including their usernames
            const users = {};
            users[userId] = { username: userName };
            users[partner1[0]] = { username: partner1[1].username }; // partner1[1] is the user data object
            users[partner2[0]] = { username: partner2[1].username };

            // Set the initial room data
            chatRoomRef.set({
                users: users,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });

            // IMPORTANT: Remove all three matched users from the lobby
            lobbyRef.child(userId).remove();
            lobbyRef.child(partner1[0]).remove();
            lobbyRef.child(partner2[0]).remove();

            // Proceed to the chat screen
            startChat();
        }
    });
}


//
// STEP 5: CHAT ROOM FUNCTIONALITY
//
async function startChat() {
    interestSelectionDiv.classList.add('hidden');
    chatContainerDiv.classList.remove('hidden');

    const chatRoomRef = database.ref(`chatRooms/${chatRoomId}`);

    // Get the user info for our room and set up presence listeners
    const usersSnapshot = await chatRoomRef.child('users').get();
    chatUsers = usersSnapshot.val();
    updatePresenceUI();

    listenForMessages();
    listenForTyping();
    listenForPresenceChanges();
    listenForRoomClosure();
}

function listenForMessages() {
    const messagesRef = database.ref(`messages/${chatRoomId}`);
    // 'child_added' is triggered for every existing message and for every new one
    messagesRef.on('child_added', snapshot => {
        displayMessage(snapshot.key, snapshot.val());
    });
}

function listenForTyping() {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing`);
    typingRef.on('value', snap => {
        const typingUsers = snap.val() || {};
        delete typingUsers[userId]; // Ignore our own typing status
        const names = Object.values(typingUsers).map(u => u.username);

        if (names.length > 0) {
            typingIndicatorDiv.textContent = `${names.join(', ')} is typing...`;
        } else {
            typingIndicatorDiv.textContent = '';
        }
    });
}

function listenForPresenceChanges() {
    const presenceRef = database.ref(`chatRooms/${chatRoomId}/users`);
    presenceRef.on('value', (snap) => {
        chatUsers = snap.val() || {};
        updatePresenceUI();
    });
}

function listenForRoomClosure() {
    const roomRef = database.ref(`chatRooms/${chatRoomId}`);
    roomRef.on('value', (snap) => {
        if (!snap.exists()) {
            alert('The chat room has been closed.');
            window.location.reload();
        }
    });
}

//
// STEP 6: SENDING MESSAGES AND TYPING INDICATORS
//
function sendMessage() {
    const text = messageInput.value.trim();
    if (text === '') return;

    const message = {
        senderId: userId,
        username: userName, // Include username directly in message
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`messages/${chatRoomId}`).push(message);

    // Stop the typing indicator immediately after sending
    database.ref(`chatRooms/${chatRoomId}/typing/${userId}`).remove();
    messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

messageInput.addEventListener('input', () => {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing/${userId}`);
    // Set our typing status
    typingRef.set({ username: userName });
    // If we stop typing for 2 seconds, remove our typing status
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typingRef.remove();
    }, 2000);
});

//
// STEP 7: UI DISPLAY AND ACTIONS
//
const userColors = {}; // Store colors to keep them consistent for each user
function getUserAvatar(uid, uname) {
    if (!userColors[uid]) {
        const colors = ['#3700B3', '#00796B', '#C2185B', '#F57C00', '#512DA8', '#D32F2F'];
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
        // Add avatar for received messages
        const avatar = getUserAvatar(message.senderId, message.username);
        msgGroup.appendChild(avatar);
    }

    msgGroup.appendChild(msgContent);
    chatMessagesDiv.appendChild(msgGroup);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Auto-scroll to bottom

    // Set a timer to make the message disappear from the screen after 1 minute
    setTimeout(() => {
        const elToRemove = document.getElementById(msgId);
        if (elToRemove) {
            elToRemove.style.transition = 'opacity 0.5s ease';
            elToRemove.style.opacity = '0';
            setTimeout(() => elToRemove.remove(), 500);
        }
        // Note: This only removes the message from the DOM (what you see).
        // For security, a Cloud Function should delete it from the database.
    }, 60000);
}

function updatePresenceUI() {
    userPresenceDiv.innerHTML = '';
    const userCount = Object.keys(chatUsers).length;
    const presenceEl = document.createElement('div');
    presenceEl.className = 'presence-indicator';
    presenceEl.textContent = `${userCount} Users Online`;
    userPresenceDiv.appendChild(presenceEl);
}

leaveChatBtn.addEventListener('click', () => {
    if (chatRoomId) {
        // Remove the entire chat room and its messages
        database.ref(`chatRooms/${chatRoomId}`).remove();
        database.ref(`messages/${chatRoomId}`).remove();
        // Reloading the page is the simplest way to reset state
        window.location.reload();
    }
});
