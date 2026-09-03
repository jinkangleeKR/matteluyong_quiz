import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const DATA_KEY = "matteluyong.quiz.builder-data";
const PLAYER_KEY = "matteluyong.quiz.player-id";
const CHANNEL_NAME = "matteluyong-quiz-builder-sync";

function makeId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return prefix + window.crypto.randomUUID();
  }
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function readJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getLocalPlayerId() {
  let playerId = window.localStorage.getItem(PLAYER_KEY);
  if (!playerId) {
    playerId = makeId("local-player-");
    window.localStorage.setItem(PLAYER_KEY, playerId);
  }
  return playerId;
}

function defaultData() {
  return { quizCatalog: {}, ownerRooms: {}, rooms: {}, roomSecrets: {} };
}

function createDemoClient(role, notice) {
  const playerId = getLocalPlayerId();
  const ownerId = "demo-admin";
  const listeners = new Set();
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

  function getData() {
    const data = readJson(DATA_KEY, defaultData());
    data.quizCatalog = data.quizCatalog || {};
    data.ownerRooms = data.ownerRooms || {};
    data.rooms = data.rooms || {};
    data.roomSecrets = data.roomSecrets || {};
    return data;
  }
  function saveData(data) {
    writeJson(DATA_KEY, data);
    listeners.forEach(function (listener) { listener(); });
    if (channel) {
      channel.postMessage({ type: "sync" });
    }
  }
  function listen(read) {
    const listener = function () { read(); };
    listeners.add(listener);
    listener();
    return function () { listeners.delete(listener); };
  }
  function roomState(roomId) {
    const room = getData().rooms[roomId] || {};
    return room.state || null;
  }

  if (channel) {
    channel.addEventListener("message", function () {
      listeners.forEach(function (listener) { listener(); });
    });
  }
  window.addEventListener("storage", function (event) {
    if (event.key === DATA_KEY) {
      listeners.forEach(function (listener) { listener(); });
    }
  });

  return {
    mode: "demo",
    notice: notice || "데모 모드: 같은 브라우저의 탭에서만 동작을 확인할 수 있습니다.",
    now: function () { return Date.now(); },
    getUser: function () {
      return role === "admin"
        ? { uid: ownerId, email: "demo@example.com", isAnonymous: false }
        : { uid: playerId, isAnonymous: true };
    },
    isAdmin: function () { return role === "admin"; },
    subscribeOwnedQuizzes: function (listener) {
      return listen(function () { listener(getData().quizCatalog[ownerId] || {}); });
    },
    saveQuiz: async function (quiz) {
      const data = getData();
      data.quizCatalog[ownerId] = data.quizCatalog[ownerId] || {};
      data.quizCatalog[ownerId][quiz.id] = Object.assign({}, quiz, { ownerUid: ownerId, updatedAt: Date.now() });
      saveData(data);
    },
    deleteQuiz: async function (quizId) {
      const data = getData();
      if (data.quizCatalog[ownerId]) { delete data.quizCatalog[ownerId][quizId]; }
      saveData(data);
    },
    subscribeOwnedRooms: function (listener) {
      return listen(function () { listener(getData().ownerRooms[ownerId] || {}); });
    },
    createRoom: async function (state, secret) {
      const data = getData();
      const roomId = createRoomId();
      const roomStateValue = Object.assign({}, state, { id: roomId, ownerUid: ownerId, createdAt: Date.now() });
      data.rooms[roomId] = { state: roomStateValue, answers: {}, lobby: {}, kicked: {}, waitingChat: {} };
      data.roomSecrets[roomId] = Object.assign({}, secret, { ownerUid: ownerId });
      data.ownerRooms[ownerId] = data.ownerRooms[ownerId] || {};
      data.ownerRooms[ownerId][roomId] = roomSummary(roomStateValue);
      saveData(data);
      return roomStateValue;
    },
    saveRoomState: async function (roomId, state) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || !room.state || room.state.ownerUid !== ownerId) { throw new Error("이 게임방을 수정할 권한이 없습니다."); }
      room.state = Object.assign({}, state, { ownerUid: ownerId, updatedAt: Date.now() });
      data.ownerRooms[ownerId] = data.ownerRooms[ownerId] || {};
      data.ownerRooms[ownerId][roomId] = roomSummary(room.state);
      saveData(data);
    },
    resetRoom: async function (roomId) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || room.state.ownerUid !== ownerId) { throw new Error("이 게임방을 수정할 권한이 없습니다."); }
      room.state = Object.assign({}, room.state, {
        status: "waiting",
        startAt: null,
        endsAt: null,
        finishedAt: null,
        resultsRevealAt: null,
        revealedAnswerKey: null,
        updatedAt: Date.now(),
      });
      room.answers = {};
      room.lobby = {};
      room.kicked = {};
      room.waitingChat = {};
      data.ownerRooms[ownerId][roomId] = roomSummary(room.state);
      saveData(data);
    },
    deleteRoom: async function (roomId) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || room.state.ownerUid !== ownerId) { throw new Error("이 게임방을 삭제할 권한이 없습니다."); }
      delete data.rooms[roomId];
      delete data.roomSecrets[roomId];
      if (data.ownerRooms[ownerId]) { delete data.ownerRooms[ownerId][roomId]; }
      saveData(data);
    },
    subscribeRoomState: function (roomId, listener) {
      return listen(function () { listener(roomState(roomId)); });
    },
    subscribeRoomSecrets: function (roomId, listener) {
      return listen(function () { listener(getData().roomSecrets[roomId] || null); });
    },
    subscribeRoomAnswers: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener(room.answers || {});
      });
    },
    subscribeMyRoomAnswers: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener((room.answers || {})[playerId] || {});
      });
    },
    subscribeRoomLobby: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener(room.lobby || {});
      });
    },
    subscribeMyRoomLobbyEntry: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener((room.lobby || {})[playerId] || null);
      });
    },
    subscribeRoomKick: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener((room.kicked || {})[playerId] || null);
      });
    },
    subscribeRoomWaitingChat: function (roomId, listener) {
      return listen(function () {
        const room = getData().rooms[roomId] || {};
        listener(room.waitingChat || {});
      });
    },
    joinRoom: async function (roomId, name) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || !room.state || room.state.status !== "waiting") { throw new Error("지금은 대기실에 입장할 수 없습니다."); }
      if ((room.kicked || {})[playerId]) { throw new Error("진행자가 대기실에서 내보낸 참가자입니다."); }
      room.lobby[playerId] = { name: name, joinedAt: Date.now() };
      saveData(data);
    },
    kickRoomParticipant: async function (roomId, uid, name) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || room.state.ownerUid !== ownerId) { throw new Error("이 게임방을 수정할 권한이 없습니다."); }
      room.kicked[uid] = { name: name || "참가자", kickedAt: Date.now() };
      delete room.lobby[uid];
      saveData(data);
    },
    sendRoomWaitingChat: async function (roomId, message) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || room.state.status !== "waiting" || !room.lobby[playerId]) { throw new Error("대기실에서만 메시지를 보낼 수 있습니다."); }
      room.waitingChat[makeId("message-")] = { uid: playerId, playerName: message.playerName, text: message.text, sentAt: Date.now() };
      saveData(data);
    },
    submitRoomAnswer: async function (roomId, answer) {
      const data = getData();
      const room = data.rooms[roomId];
      if (!room || room.state.status !== "live" || !room.lobby[playerId]) { throw new Error("답안을 제출할 수 없습니다."); }
      room.answers[playerId] = room.answers[playerId] || {};
      room.answers[playerId][answer.questionIndex] = { choice: answer.choice, playerName: answer.playerName, answeredAt: Date.now() };
      saveData(data);
    },
    signInAdmin: async function () { return { uid: ownerId, email: "demo@example.com" }; },
    signUpAdmin: async function () { return { uid: ownerId, email: "demo@example.com" }; },
    signOut: async function () {},
  };
}

function roomSummary(state) {
  return {
    title: state.title || "제목 없는 퀴즈",
    quizId: state.quizId || "",
    status: state.status || "waiting",
    createdAt: state.createdAt || Date.now(),
    updatedAt: state.updatedAt || Date.now(),
  };
}

async function createFirebaseClient(role) {
  const appModule = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
  const authModule = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
  const databaseModule = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
  const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  const database = databaseModule.getDatabase(app);
  let serverOffset = 0;

  await new Promise(function (resolve) {
    let unsubscribe = null;
    let ready = false;
    function finish() {
      ready = true;
      if (unsubscribe) { unsubscribe(); }
      resolve();
    }
    unsubscribe = authModule.onAuthStateChanged(auth, finish);
    if (ready && unsubscribe) { unsubscribe(); }
  });

  databaseModule.onValue(databaseModule.ref(database, ".info/serverTimeOffset"), function (snapshot) {
    serverOffset = Number(snapshot.val()) || 0;
  });
  window.addEventListener("pagehide", function () { databaseModule.goOffline(database); });
  window.addEventListener("pageshow", function () { databaseModule.goOnline(database); });

  if (role === "participant" && !auth.currentUser) {
    await authModule.signInAnonymously(auth);
  }

  function getUser() { return auth.currentUser; }
  function isAdmin() {
    const user = getUser();
    return Boolean(user && !user.isAnonymous && user.email);
  }
  function requireUser() {
    const user = getUser();
    if (!user) { throw new Error("인증을 준비하지 못했습니다. 페이지를 새로고침해 주세요."); }
    return user;
  }
  function requireAdmin() {
    const user = requireUser();
    if (!isAdmin()) { throw new Error("이메일/비밀번호로 관리자 로그인한 뒤 사용할 수 있습니다."); }
    return user;
  }
  function roomRef(roomId, path) {
    return databaseModule.ref(database, "rooms/" + roomId + (path ? "/" + path : ""));
  }

  return {
    mode: "firebase",
    notice: "",
    now: function () { return Date.now() + serverOffset; },
    getUser: getUser,
    isAdmin: isAdmin,
    subscribeOwnedQuizzes: function (listener) {
      const user = requireAdmin();
      return databaseModule.onValue(databaseModule.ref(database, "quizCatalog/" + user.uid), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    saveQuiz: async function (quiz) {
      const user = requireAdmin();
      await databaseModule.set(databaseModule.ref(database, "quizCatalog/" + user.uid + "/" + quiz.id), Object.assign({}, quiz, {
        ownerUid: user.uid,
        updatedAt: databaseModule.serverTimestamp(),
      }));
    },
    deleteQuiz: async function (quizId) {
      const user = requireAdmin();
      await databaseModule.remove(databaseModule.ref(database, "quizCatalog/" + user.uid + "/" + quizId));
    },
    subscribeOwnedRooms: function (listener) {
      const user = requireAdmin();
      return databaseModule.onValue(databaseModule.ref(database, "ownerRooms/" + user.uid), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    createRoom: async function (state, secret) {
      const user = requireAdmin();
      const roomId = createRoomId();
      const roomStateValue = Object.assign({}, state, {
        id: roomId,
        ownerUid: user.uid,
        createdAt: databaseModule.serverTimestamp(),
        updatedAt: databaseModule.serverTimestamp(),
      });
      await databaseModule.update(databaseModule.ref(database), {
        ["rooms/" + roomId + "/state"]: roomStateValue,
        ["roomSecrets/" + roomId]: Object.assign({}, secret, { ownerUid: user.uid }),
        ["ownerRooms/" + user.uid + "/" + roomId]: roomSummary(Object.assign({}, state, { createdAt: Date.now(), updatedAt: Date.now() })),
      });
      return Object.assign({}, state, { id: roomId, ownerUid: user.uid });
    },
    saveRoomState: async function (roomId, state) {
      const user = requireAdmin();
      await databaseModule.set(roomRef(roomId, "state"), Object.assign({}, state, {
        ownerUid: user.uid,
        updatedAt: databaseModule.serverTimestamp(),
      }));
      await databaseModule.set(databaseModule.ref(database, "ownerRooms/" + user.uid + "/" + roomId), roomSummary(state));
    },
    resetRoom: async function (roomId, state) {
      const user = requireAdmin();
      const waitingState = Object.assign({}, state, {
        ownerUid: user.uid,
        status: "waiting",
        startAt: null,
        endsAt: null,
        finishedAt: null,
        resultsRevealAt: null,
        revealedAnswerKey: null,
        updatedAt: databaseModule.serverTimestamp(),
      });
      await databaseModule.update(databaseModule.ref(database), {
        ["rooms/" + roomId + "/state"]: waitingState,
        ["rooms/" + roomId + "/answers"]: null,
        ["rooms/" + roomId + "/lobby"]: null,
        ["rooms/" + roomId + "/kicked"]: null,
        ["rooms/" + roomId + "/waitingChat"]: null,
        ["ownerRooms/" + user.uid + "/" + roomId]: roomSummary(waitingState),
      });
    },
    deleteRoom: async function (roomId) {
      const user = requireAdmin();
      await databaseModule.update(databaseModule.ref(database), {
        ["rooms/" + roomId]: null,
        ["roomSecrets/" + roomId]: null,
        ["ownerRooms/" + user.uid + "/" + roomId]: null,
      });
    },
    subscribeRoomState: function (roomId, listener) {
      return databaseModule.onValue(roomRef(roomId, "state"), function (snapshot) { listener(snapshot.val() || null); });
    },
    subscribeRoomSecrets: function (roomId, listener) {
      requireAdmin();
      return databaseModule.onValue(databaseModule.ref(database, "roomSecrets/" + roomId), function (snapshot) { listener(snapshot.val() || null); });
    },
    subscribeRoomAnswers: function (roomId, listener) {
      return databaseModule.onValue(roomRef(roomId, "answers"), function (snapshot) { listener(snapshot.val() || {}); });
    },
    subscribeMyRoomAnswers: function (roomId, listener) {
      const user = requireUser();
      return databaseModule.onValue(roomRef(roomId, "answers/" + user.uid), function (snapshot) { listener(snapshot.val() || {}); });
    },
    subscribeRoomLobby: function (roomId, listener) {
      return databaseModule.onValue(roomRef(roomId, "lobby"), function (snapshot) { listener(snapshot.val() || {}); });
    },
    subscribeMyRoomLobbyEntry: function (roomId, listener) {
      const user = requireUser();
      return databaseModule.onValue(roomRef(roomId, "lobby/" + user.uid), function (snapshot) { listener(snapshot.val() || null); });
    },
    subscribeRoomKick: function (roomId, listener) {
      const user = requireUser();
      return databaseModule.onValue(roomRef(roomId, "kicked/" + user.uid), function (snapshot) { listener(snapshot.val() || null); });
    },
    subscribeRoomWaitingChat: function (roomId, listener) {
      return databaseModule.onValue(roomRef(roomId, "waitingChat"), function (snapshot) { listener(snapshot.val() || {}); });
    },
    joinRoom: async function (roomId, name) {
      const user = requireUser();
      await databaseModule.set(roomRef(roomId, "lobby/" + user.uid), {
        name: name,
        joinedAt: databaseModule.serverTimestamp(),
      });
    },
    kickRoomParticipant: async function (roomId, uid, name) {
      const user = requireAdmin();
      await databaseModule.set(roomRef(roomId, "kicked/" + uid), {
        name: name || "참가자",
        kickedAt: databaseModule.serverTimestamp(),
      });
      await databaseModule.remove(roomRef(roomId, "lobby/" + uid));
      return user.uid;
    },
    sendRoomWaitingChat: async function (roomId, message) {
      const user = requireUser();
      const messageRef = databaseModule.push(roomRef(roomId, "waitingChat"));
      await databaseModule.set(messageRef, {
        uid: user.uid,
        playerName: message.playerName,
        text: message.text,
        sentAt: databaseModule.serverTimestamp(),
      });
    },
    submitRoomAnswer: async function (roomId, answer) {
      const user = requireUser();
      await databaseModule.set(roomRef(roomId, "answers/" + user.uid + "/" + answer.questionIndex), {
        choice: answer.choice,
        playerName: answer.playerName,
        answeredAt: databaseModule.serverTimestamp(),
      });
    },
    signInAdmin: async function (email, password) {
      const credential = await authModule.signInWithEmailAndPassword(auth, email, password);
      return credential.user;
    },
    signUpAdmin: async function (email, password) {
      const credential = await authModule.createUserWithEmailAndPassword(auth, email, password);
      await databaseModule.set(databaseModule.ref(database, "profiles/" + credential.user.uid), {
        email: credential.user.email || "",
        createdAt: databaseModule.serverTimestamp(),
      });
      return credential.user;
    },
    signOut: function () { return authModule.signOut(auth); },
  };
}

export async function createQuizClient(role) {
  const forceDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  if (forceDemo) {
    return createDemoClient(role, "통합 테스트 모드: 이 화면의 데이터는 브라우저에만 저장됩니다.");
  }
  if (!isFirebaseConfigured) {
    return createDemoClient(role);
  }
  try {
    return await createFirebaseClient(role);
  } catch (error) {
    return createDemoClient(role, "Firebase에 연결하지 못해 데모 모드로 전환했습니다.");
  }
}

export function createQuizId() {
  return makeId("quiz-");
}

export function createRoomId() {
  return makeId("room-").replaceAll("-", "").slice(0, 24);
}
