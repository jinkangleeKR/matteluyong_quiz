import {
  firebaseAdminUid,
  firebaseConfig,
  isFirebaseConfigured,
} from "./firebase-config.js";

const GAME_KEY = "matteluyong.quiz.active-game";
const ANSWERS_KEY = "matteluyong.quiz.answers";
const LOBBY_KEY = "matteluyong.quiz.lobby";
const KICKED_KEY = "matteluyong.quiz.kicked";
const WAITING_CHAT_KEY = "matteluyong.quiz.waiting-chat";
const PLAYER_KEY = "matteluyong.quiz.player-id";
const CHANNEL_NAME = "matteluyong-quiz-sync";

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

function makeId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return prefix + window.crypto.randomUUID();
  }
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getLocalPlayerId() {
  let playerId = window.localStorage.getItem(PLAYER_KEY);
  if (!playerId) {
    playerId = makeId("local-");
    window.localStorage.setItem(PLAYER_KEY, playerId);
  }
  return playerId;
}

function createDemoClient(notice) {
  const gameListeners = new Set();
  const answerListeners = new Map();
  const lobbyEntryListeners = new Set();
  const lobbyListeners = new Set();
  const kickListeners = new Set();
  const chatListeners = new Set();
  const playerId = getLocalPlayerId();
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

  function getGame() {
    return readJson(GAME_KEY, { status: "waiting" });
  }
  function getAnswers(gameId) {
    const allAnswers = readJson(ANSWERS_KEY, {});
    return allAnswers[gameId] || {};
  }
  function getLobby() {
    return readJson(LOBBY_KEY, {});
  }
  function getKicked() {
    return readJson(KICKED_KEY, {});
  }
  function getWaitingChat() {
    return readJson(WAITING_CHAT_KEY, {});
  }
  function emitGame() {
    gameListeners.forEach(function (listener) { listener(getGame()); });
  }
  function emitAnswers() {
    answerListeners.forEach(function (listeners, gameId) {
      const answers = getAnswers(gameId);
      listeners.forEach(function (listener) { listener(answers); });
    });
  }
  function emitLobby() {
    const lobby = getLobby();
    lobbyEntryListeners.forEach(function (listener) { listener(lobby[playerId] || null); });
    lobbyListeners.forEach(function (listener) { listener(lobby); });
  }
  function emitKicked() {
    const kicked = getKicked();
    kickListeners.forEach(function (listener) { listener(kicked[playerId] || null); });
  }
  function emitChat() {
    const messages = getWaitingChat();
    chatListeners.forEach(function (listener) { listener(messages); });
  }
  function emitLocal() {
    emitGame();
    emitAnswers();
    emitLobby();
    emitKicked();
    emitChat();
  }
  function announce() {
    emitLocal();
    if (channel) {
      channel.postMessage({ type: "sync" });
    }
  }

  if (channel) {
    channel.addEventListener("message", emitLocal);
  }
  window.addEventListener("storage", function (event) {
    if ([GAME_KEY, ANSWERS_KEY, LOBBY_KEY, KICKED_KEY, WAITING_CHAT_KEY].includes(event.key)) {
      emitLocal();
    }
  });

  return {
    mode: "demo",
    notice: notice || "데모 모드: 같은 브라우저의 탭에서만 실시간으로 동기화됩니다.",
    playerId: playerId,
    now: function () { return Date.now(); },
    isAdmin: function () { return true; },
    getUser: function () { return { uid: playerId, isAnonymous: true }; },
    subscribeGame: function (listener) {
      gameListeners.add(listener);
      listener(getGame());
      return function () { gameListeners.delete(listener); };
    },
    subscribeMyAnswers: function (gameId, listener) {
      const wrapped = function (answers) { listener(answers[playerId] || {}); };
      const listeners = answerListeners.get(gameId) || new Set();
      listeners.add(wrapped);
      answerListeners.set(gameId, listeners);
      wrapped(getAnswers(gameId));
      return function () {
        const current = answerListeners.get(gameId);
        if (current) { current.delete(wrapped); }
      };
    },
    subscribeAllAnswers: function (gameId, listener) {
      const listeners = answerListeners.get(gameId) || new Set();
      listeners.add(listener);
      answerListeners.set(gameId, listeners);
      listener(getAnswers(gameId));
      return function () {
        const current = answerListeners.get(gameId);
        if (current) { current.delete(listener); }
      };
    },
    subscribeLobbyEntry: function (listener) {
      lobbyEntryListeners.add(listener);
      listener(getLobby()[playerId] || null);
      return function () { lobbyEntryListeners.delete(listener); };
    },
    subscribeLobby: function (listener) {
      lobbyListeners.add(listener);
      listener(getLobby());
      return function () { lobbyListeners.delete(listener); };
    },
    subscribeKick: function (listener) {
      kickListeners.add(listener);
      listener(getKicked()[playerId] || null);
      return function () { kickListeners.delete(listener); };
    },
    subscribeWaitingChat: function (listener) {
      chatListeners.add(listener);
      listener(getWaitingChat());
      return function () { chatListeners.delete(listener); };
    },
    saveGame: async function (game) {
      writeJson(GAME_KEY, game);
      announce();
    },
    resetWaitingRoom: async function () {
      writeJson(GAME_KEY, { status: "waiting", updatedAt: Date.now() });
      writeJson(LOBBY_KEY, {});
      writeJson(KICKED_KEY, {});
      writeJson(WAITING_CHAT_KEY, {});
      announce();
    },
    joinLobby: async function (name) {
      const game = getGame();
      if (game.status === "live" || game.status === "finished") {
        throw new Error("지금은 대기실에 입장할 수 없습니다.");
      }
      if (getKicked()[playerId]) {
        throw new Error("진행자가 대기실에서 내보낸 참가자입니다.");
      }
      const lobby = getLobby();
      lobby[playerId] = { name: name, joinedAt: Date.now() };
      writeJson(LOBBY_KEY, lobby);
      announce();
    },
    kickParticipant: async function (uid, name) {
      const lobby = getLobby();
      const kicked = getKicked();
      delete lobby[uid];
      kicked[uid] = { name: name || "참가자", kickedAt: Date.now() };
      writeJson(LOBBY_KEY, lobby);
      writeJson(KICKED_KEY, kicked);
      announce();
    },
    sendWaitingChat: async function (message) {
      const game = getGame();
      if (game.status === "live" || game.status === "finished" || !getLobby()[playerId] || getKicked()[playerId]) {
        throw new Error("대기실에서만 메시지를 보낼 수 있습니다.");
      }
      const messages = getWaitingChat();
      messages[makeId("message-")] = {
        uid: playerId,
        playerName: message.playerName,
        text: message.text,
        sentAt: Date.now(),
      };
      writeJson(WAITING_CHAT_KEY, messages);
      announce();
    },
    submitAnswer: async function (answer) {
      const allAnswers = readJson(ANSWERS_KEY, {});
      const gameAnswers = allAnswers[answer.gameId] || {};
      const playerAnswers = gameAnswers[playerId] || {};
      playerAnswers[answer.questionIndex] = {
        choice: answer.choice,
        playerName: answer.playerName,
        answeredAt: Date.now(),
      };
      gameAnswers[playerId] = playerAnswers;
      allAnswers[answer.gameId] = gameAnswers;
      writeJson(ANSWERS_KEY, allAnswers);
      announce();
      return true;
    },
    signInAdmin: async function () { return { uid: playerId }; },
    signOut: async function () {},
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

  databaseModule.onValue(databaseModule.ref(database, ".info/serverTimeOffset"), function (snapshot) {
    serverOffset = Number(snapshot.val()) || 0;
  });
  if (role === "participant" && !auth.currentUser) {
    await authModule.signInAnonymously(auth);
  }

  function getUser() { return auth.currentUser; }
  function isAdmin() {
    const user = getUser();
    return Boolean(firebaseAdminUid && user && user.uid === firebaseAdminUid);
  }
  function requireAdmin() {
    if (!isAdmin()) {
      throw new Error("관리자 계정으로 로그인한 뒤 사용할 수 있습니다.");
    }
  }
  function requireUser() {
    const user = getUser();
    if (!user) {
      throw new Error("참가자 인증을 준비하지 못했습니다. 페이지를 새로고침해 주세요.");
    }
    return user;
  }

  return {
    mode: "firebase",
    notice: "Firebase 실시간 모드: 모든 참가자가 같은 진행 상태와 타이머를 공유합니다.",
    get playerId() {
      const user = getUser();
      return user ? user.uid : "";
    },
    now: function () { return Date.now() + serverOffset; },
    isAdmin: isAdmin,
    getUser: getUser,
    subscribeGame: function (listener) {
      return databaseModule.onValue(databaseModule.ref(database, "activeGame"), function (snapshot) {
        listener(snapshot.val() || { status: "waiting" });
      });
    },
    subscribeMyAnswers: function (gameId, listener) {
      const user = getUser();
      if (!user) {
        listener({});
        return function () {};
      }
      return databaseModule.onValue(databaseModule.ref(database, "answers/" + gameId + "/" + user.uid), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    subscribeAllAnswers: function (gameId, listener) {
      requireAdmin();
      return databaseModule.onValue(databaseModule.ref(database, "answers/" + gameId), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    subscribeLobbyEntry: function (listener) {
      const user = getUser();
      if (!user) {
        listener(null);
        return function () {};
      }
      return databaseModule.onValue(databaseModule.ref(database, "lobby/" + user.uid), function (snapshot) {
        listener(snapshot.val() || null);
      });
    },
    subscribeLobby: function (listener) {
      requireAdmin();
      return databaseModule.onValue(databaseModule.ref(database, "lobby"), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    subscribeKick: function (listener) {
      const user = getUser();
      if (!user) {
        listener(null);
        return function () {};
      }
      return databaseModule.onValue(databaseModule.ref(database, "kicked/" + user.uid), function (snapshot) {
        listener(snapshot.val() || null);
      });
    },
    subscribeWaitingChat: function (listener) {
      return databaseModule.onValue(databaseModule.ref(database, "waitingChat"), function (snapshot) {
        listener(snapshot.val() || {});
      });
    },
    saveGame: async function (game) {
      requireAdmin();
      await databaseModule.set(databaseModule.ref(database, "activeGame"), game);
    },
    resetWaitingRoom: async function () {
      requireAdmin();
      await databaseModule.update(databaseModule.ref(database), {
        activeGame: { status: "waiting", updatedAt: databaseModule.serverTimestamp() },
        lobby: null,
        kicked: null,
        waitingChat: null,
      });
    },
    joinLobby: async function (name) {
      const user = requireUser();
      await databaseModule.set(databaseModule.ref(database, "lobby/" + user.uid), {
        name: name,
        joinedAt: databaseModule.serverTimestamp(),
      });
    },
    kickParticipant: async function (uid, name) {
      requireAdmin();
      await databaseModule.update(databaseModule.ref(database), {
        ["lobby/" + uid]: null,
        ["kicked/" + uid]: { name: name || "참가자", kickedAt: databaseModule.serverTimestamp() },
      });
    },
    sendWaitingChat: async function (message) {
      const user = requireUser();
      const messageRef = databaseModule.push(databaseModule.ref(database, "waitingChat"));
      await databaseModule.set(messageRef, {
        uid: user.uid,
        playerName: message.playerName,
        text: message.text,
        sentAt: databaseModule.serverTimestamp(),
      });
    },
    submitAnswer: async function (answer) {
      const user = requireUser();
      const answerRef = databaseModule.ref(database, "answers/" + answer.gameId + "/" + user.uid + "/" + answer.questionIndex);
      await databaseModule.set(answerRef, {
        choice: answer.choice,
        playerName: answer.playerName,
        answeredAt: databaseModule.serverTimestamp(),
      });
      return true;
    },
    signInAdmin: async function (email, password) {
      const credential = await authModule.signInWithEmailAndPassword(auth, email, password);
      if (!firebaseAdminUid) {
        await authModule.signOut(auth);
        throw new Error("firebase-config.js에 firebaseAdminUid를 입력해 주세요.");
      }
      if (credential.user.uid !== firebaseAdminUid) {
        await authModule.signOut(auth);
        throw new Error("이 계정에는 관리자 권한이 없습니다.");
      }
      return credential.user;
    },
    signOut: function () { return authModule.signOut(auth); },
  };
}

export async function createQuizClient(role) {
  if (!isFirebaseConfigured) {
    return createDemoClient();
  }
  try {
    return await createFirebaseClient(role);
  } catch (error) {
    return createDemoClient("Firebase에 연결하지 못해 데모 모드로 전환했습니다. 설정값과 Firebase 인증 상태를 확인해 주세요.");
  }
}

export function createGameId(startAt) {
  return "game-" + startAt + "-" + Math.random().toString(36).slice(2, 8);
}
