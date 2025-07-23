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
let userName = 'User' + Math.floor(Math.random() * 1000);
let chatRoomId = null;
let chatUsers = {};
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
    findOrCreateChat();
});

//
// STEP 4: USER MATCHING LOGIC (UPDATED AND CORRECTED)
//
async function findOrCreateChat() {
    const lobbyRef = database.ref('lobby');
    const myLobbyRef = lobbyRef.child(userId);
    const myInviteRef = database.ref(`user_invites/${userId}`);

    // Part 1: Every user listens for a direct invitation to a room.
    myInviteRef.on('value', async (snapshot) => {
        if (snapshot.exists()) {
            // Invitation received!
            chatRoomId = snapshot.val().roomId;

            // Clean up all listeners, remove self from lobby, and enter the chat.
            myInviteRef.off();
            myInviteRef.remove();
            lobbyRef.off();
            myLobbyRef.onDisconnect().cancel(); // Cancel the lobby cleanup action
            myLobbyRef.remove();

            await startChat();
        }
    });

    // Part 2: Add self to lobby and try to become a "creator".
    await myLobbyRef.set({
        interests: selectedInterests,
        username: userName,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    // Set cleanup action in case user closes tab before being matched.
    myLobbyRef.onDisconnect().remove();

    // Listen for changes in the lobby to find partners.
    lobbyRef.on('value', async (snapshot) => {
        if (chatRoomId) { // We've been matched, so stop this logic.
            lobbyRef.off();
            return;
        }

        const lobbyUsers = snapshot.val();
        if (!lobbyUsers) return;

        const potentialPartners = Object.entries(lobbyUsers).filter(([id, data]) =>
            id !== userId && data.interests.some(interest => selectedInterests.includes(interest))
        );

        if (potentialPartners.length >= 2) {
            // This user is the "creator"! We found two partners.
            lobbyRef.off(); // Stop listening to prevent creating more rooms.

            const partner1 = potentialPartners[0];
            const partner2 = potentialPartners[1];

            // === CRITICAL FIX: Create a shared, deterministic room ID ===
            // By sorting the user IDs, all three users will generate the exact same ID.
            const allUserIds = [userId, partner1[0], partner2[0]].sort();
            const newChatRoomId = allUserIds.join('_');
            // ==========================================================

            // As the creator, we now "invite" the other two users to this room.
            await database.ref(`user_invites/${partner1[0]}`).set({ roomId: newChatRoomId });
            await database.ref(`user_invites/${partner2[0]}`).set({ roomId: newChatRoomId });

            // The creator can now enter the chat themselves using the same ID.
            chatRoomId = newChatRoomId;
            myInviteRef.off(); // We don't need our own invite listener anymore.
            myLobbyRef.onDisconnect().cancel(); // Don't remove from lobby on disconnect.
            await startChat();
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
    
    // Set initial user list if it doesn't exist
    const roomSnapshot = await chatRoomRef.get();
    if (!roomSnapshot.exists()) {
        const users = {};
        const lobbySnapshot = await database.ref('lobby').get();
        const allUsers = lobbySnapshot.val();
        // This part is a fallback, the main user data comes from presence
    }

    const myPresenceRef = database.ref(`chatRooms/${chatRoomId}/presence/${userId}`);
    myPresenceRef.onDisconnect().remove();
    myPresenceRef.set({ username: userName });

    listenForMessages();
    listenForTyping();
    listenForPresenceChanges();
    listenForRoomClosure();
}

function listenForMessages() {
    const messagesRef = database.ref(`messages/${chatRoomId}`);
    messagesRef.on('child_added', snapshot => {
        displayMessage(snapshot.key, snapshot.val());
    });
}

function listenForTyping() {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing`);
    typingRef.on('value', snap => {
        const typingUsers = snap.val() || {};
        delete typingUsers[userId];
        const names = Object.values(typingUsers).map(u => u.username);

        if (names.length > 0) {
            typingIndicatorDiv.textContent = `${names.join(', ')} is typing...`;
        } else {
            typingIndicatorDiv.textContent = '';
        }
    });
}

function listenForPresenceChanges() {
    const presenceRef = database.ref(`chatRooms/${chatRoomId}/presence`);
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
        username: userName,
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`messages/${chatRoomId}`).push(message);
    database.ref(`chatRooms/${chatRoomId}/typing/${userId}`).remove();
    messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') sendMessage(); });

messageInput.addEventListener('input', () => {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing/${userId}`);
    typingRef.set({ username: userName });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typingRef.remove();
    }, 2000);
});

//
// STEP 7: UI DISPLAY AND ACTIONS
//
const userColors = {};
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
        const avatar = getUserAvatar(message.senderId, message.username);
        msgGroup.appendChild(avatar);
    }

    msgGroup.appendChild(msgContent);
    chatMessagesDiv.appendChild(msgGroup);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

    setTimeout(() => {
        const elToRemove = document.getElementById(msgId);
        if (elToRemove) {
            elToRemove.style.transition = 'opacity 0.5s ease';
            elToRemove.style.opacity = '0';
            setTimeout(() => elToRemove.remove(), 500);
        }
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
        database.ref(`chatRooms/${chatRoomId}`).remove();
        database.ref(`messages/${chatRoomId}`).remove();
        window.location.reload();
    }
});





//
// STEP 1: FIREBASE CONFIGURATION & INITIALIZATION
//
// =================== IMPORTANT ===================
//      REPLACE THIS WITH YOUR OWN FIREBASE CONFIG
// ===============================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
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
let userName = 'User' + Math.floor(Math.random() * 1000);
let chatRoomId = null;
let chatUsers = {};
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
    findOrCreateChat();
});

//
// STEP 4: USER MATCHING LOGIC (UPDATED AND CORRECTED)
//
async function findOrCreateChat() {
    const lobbyRef = database.ref('lobby');
    const myLobbyRef = lobbyRef.child(userId);
    const myInviteRef = database.ref(`user_invites/${userId}`);

    // Part 1: Every user listens for a direct invitation to a room.
    myInviteRef.on('value', async (snapshot) => {
        if (snapshot.exists()) {
            // Invitation received!
            chatRoomId = snapshot.val().roomId;

            // Clean up all listeners, remove self from lobby, and enter the chat.
            myInviteRef.off();
            myInviteRef.remove();
            lobbyRef.off();
            myLobbyRef.onDisconnect().cancel(); // Cancel the lobby cleanup action
            myLobbyRef.remove();

            await startChat();
        }
    });

    // Part 2: Add self to lobby and try to become a "creator".
    await myLobbyRef.set({
        interests: selectedInterests,
        username: userName,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    // Set cleanup action in case user closes tab before being matched.
    myLobbyRef.onDisconnect().remove();

    // Listen for changes in the lobby to find partners.
    lobbyRef.on('value', async (snapshot) => {
        if (chatRoomId) { // We've been matched, so stop this logic.
            lobbyRef.off();
            return;
        }

        const lobbyUsers = snapshot.val();
        if (!lobbyUsers) return;

        const potentialPartners = Object.entries(lobbyUsers).filter(([id, data]) =>
            id !== userId && data.interests.some(interest => selectedInterests.includes(interest))
        );

        if (potentialPartners.length >= 2) {
            // This user is the "creator"! We found two partners.
            lobbyRef.off(); // Stop listening to prevent creating more rooms.

            const partner1 = potentialPartners[0];
            const partner2 = potentialPartners[1];

            // === CRITICAL FIX: Create a shared, deterministic room ID ===
            // By sorting the user IDs, all three users will generate the exact same ID.
            const allUserIds = [userId, partner1[0], partner2[0]].sort();
            const newChatRoomId = allUserIds.join('_');
            // ==========================================================

            // As the creator, we now "invite" the other two users to this room.
            await database.ref(`user_invites/${partner1[0]}`).set({ roomId: newChatRoomId });
            await database.ref(`user_invites/${partner2[0]}`).set({ roomId: newChatRoomId });

            // The creator can now enter the chat themselves using the same ID.
            chatRoomId = newChatRoomId;
            myInviteRef.off(); // We don't need our own invite listener anymore.
            myLobbyRef.onDisconnect().cancel(); // Don't remove from lobby on disconnect.
            await startChat();
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
    
    // Set initial user list if it doesn't exist
    const roomSnapshot = await chatRoomRef.get();
    if (!roomSnapshot.exists()) {
        const users = {};
        const lobbySnapshot = await database.ref('lobby').get();
        const allUsers = lobbySnapshot.val();
        // This part is a fallback, the main user data comes from presence
    }

    const myPresenceRef = database.ref(`chatRooms/${chatRoomId}/presence/${userId}`);
    myPresenceRef.onDisconnect().remove();
    myPresenceRef.set({ username: userName });

    listenForMessages();
    listenForTyping();
    listenForPresenceChanges();
    listenForRoomClosure();
}

function listenForMessages() {
    const messagesRef = database.ref(`messages/${chatRoomId}`);
    messagesRef.on('child_added', snapshot => {
        displayMessage(snapshot.key, snapshot.val());
    });
}

function listenForTyping() {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing`);
    typingRef.on('value', snap => {
        const typingUsers = snap.val() || {};
        delete typingUsers[userId];
        const names = Object.values(typingUsers).map(u => u.username);

        if (names.length > 0) {
            typingIndicatorDiv.textContent = `${names.join(', ')} is typing...`;
        } else {
            typingIndicatorDiv.textContent = '';
        }
    });
}

function listenForPresenceChanges() {
    const presenceRef = database.ref(`chatRooms/${chatRoomId}/presence`);
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
        username: userName,
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref(`messages/${chatRoomId}`).push(message);
    database.ref(`chatRooms/${chatRoomId}/typing/${userId}`).remove();
    messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') sendMessage(); });

messageInput.addEventListener('input', () => {
    const typingRef = database.ref(`chatRooms/${chatRoomId}/typing/${userId}`);
    typingRef.set({ username: userName });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typingRef.remove();
    }, 2000);
});

//
// STEP 7: UI DISPLAY AND ACTIONS
//
const userColors = {};
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
        const avatar = getUserAvatar(message.senderId, message.username);
        msgGroup.appendChild(avatar);
    }

    msgGroup.appendChild(msgContent);
    chatMessagesDiv.appendChild(msgGroup);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

    setTimeout(() => {
        const elToRemove = document.getElementById(msgId);
        if (elToRemove) {
            elToRemove.style.transition = 'opacity 0.5s ease';
            elToRemove.style.opacity = '0';
            setTimeout(() => elToRemove.remove(), 500);
        }
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
        database.ref(`chatRooms/${chatRoomId}`).remove();
        database.ref(`messages/${chatRoomId}`).remove();
        window.location.reload();
    }
});
