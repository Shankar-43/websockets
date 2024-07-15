const { log } = require("console");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.get("/", (req, res) => {
  res.send("WebSocket server is running.");
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let waitingLobby = [];
let host = null;
let endMeetingTimer = null;

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("disconnect", () => {
    console.log("user disconnected");
    if (socket === host) {
      host = null;
      waitingLobby = [];
      clearTimeout(endMeetingTimer);

      // Notify all clients that the host ended the meeting
      socket.send(
        "message",
        JSON.stringify({
          type: "host_end_meeting",
          message: "The host has ended the meeting.",
        })
      );
    } else {
      const guest = waitingLobby.find((client) => client.socket === socket);
      if (guest) {
        waitingLobby = waitingLobby.filter((client) => client !== guest);
        console.log("waitingLobby",waitingLobby);
        // Notify the host that a guest has left the meeting
        if (host) {
          host.send(
            JSON.stringify({
              type: "guest_leave_meeting",
              guestId: guest.id,
              username: guest.username,
            })
          );
        }
      }
    }
  });

  socket.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "join_meeting" && data.role === 1) {
        // Host joins
        host = socket;
        socket.send(
          JSON.stringify({
            type: "host_joined",
            message: "Host has joined the meeting.",
          })
        );

        // Send the host a message for each user in the waiting lobby
        waitingLobby.forEach((client) => {
          host.send(
            JSON.stringify({
              type: "guest_joined",
              guestId: client.id,
              username: client.username,
            })
          );
        });

        // Start the timer to end the meeting after 15 minutes if no guests join
        endMeetingTimer = setTimeout(() => {
          if (waitingLobby.length === 0) {
            host.send(
              JSON.stringify({
                type: "end_meeting",
                message: "No guests joined. Meeting is ended.",
              })
            );
            host.disconnect(true);
            host = null;
          }
        }, 15 * 60 * 1000); // Adjusted to 1 minute for testing purposes
      }

      if (data.type === "join_lobby" && data.role === 0) {
        // Guest joins lobby

        const guestId = generateUniqueId();
        const guest = { socket, id: guestId, username: data.userName };
        waitingLobby.push(guest);
        socket.send(
          JSON.stringify({
            type: "waiting",
            message: "Please wait in the lobby.",
            guestId,
          })
        );
        if (host) {
          host.send(
            JSON.stringify({
              type: "guest_joined",
              guestId,
              username: guest.username,
            })
          );
        }

        // Clear the timer if a guest joins
        clearTimeout(endMeetingTimer);
      }

      if (data.type === "approve_guest" && host === socket) {
        const guest = waitingLobby.find((client) => client.id === data.guestID);
        if (guest) {
          guest.socket.send(
            JSON.stringify({
              type: "approved",
              message: "You are approved to join the meeting.",
            })
          );
          waitingLobby = waitingLobby.filter((client) => client !== guest);
        }
      }

      if (data.type === "reject_guest" && host === socket) {
        const guest = waitingLobby.find((client) => client.id === data.guestID);
        if (guest) {
          guest.socket.send(
            JSON.stringify({
              type: "rejected",
              message: "You are not allowed to join the meeting.",
            })
          );
          waitingLobby = waitingLobby.filter((client) => client !== guest);
        }
      }

      if (data.type === "guest_leave") {
        const guest = waitingLobby.find((client) => client.socket === socket);
        console.log("guest",guest);
        if (guest) {
          waitingLobby = waitingLobby.filter((client) => client !== guest);
          socket.disconnect();

          // Notify the host that a guest has left the meeting
          if (host) {
            host.send(
              JSON.stringify({
                type: "guest_leave_meeting",
                guestId: guest.id,
                username: guest.username,
              })
            );
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  socket.on("error", (error) => {
    console.error("Socket.IO error:", error);
  });
});

server.listen(8080, () => {
  console.log("listening on *:8080");
});

// Function to generate unique ids for guests
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
