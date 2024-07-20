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
let joinedPatients = [];
let doctor = null;
let endMeetingTimer = null;
let meetingExpired = false;

function handleDoctorJoin(socket, data) {
  if (meetingExpired) {
    socket.send(
      JSON.stringify({
        type: "meeting_expired",
        message: "The meeting has expired.",
      })
    );
    socket.disconnect();
    return;
  }

  doctor = socket;
  doctor.sessionId = data.sessionID;
  console.log("Doctor joined:", doctor.sessionId);

  socket.send(
    JSON.stringify({
      type: "doctor_joined",
      message: "Doctor has joined the meeting.",
    })
  );

  waitingLobby.forEach((client) => {
    doctor.send(
      JSON.stringify({
        type: "patient_request",
        patientId: client.id,
        username: client.username,
      })
    );
  });

  endMeetingTimer = setTimeout(() => {
    if (waitingLobby.length === 0 && joinedPatients.length === 0 && doctor) {
      doctor.send(
        JSON.stringify({
          type: "end_meeting",
          message: "No patients joined. Meeting is ended.",
        })
      );

      doctor.disconnect(true);
      doctor = null;
    }
  }, 15 * 60 * 1000);
}

function handlePatientJoin(socket, data) {
  const patientId = data.sessionID;
  const patient = { socket, id: patientId, username: data.userName };

  // Remove patient from waitingLobby and joinedPatients if they rejoin
  waitingLobby = waitingLobby.filter((client) => client.id !== patientId);
  joinedPatients = joinedPatients.filter((client) => client.id !== patientId);

  waitingLobby.push(patient);
  socket.send(
    JSON.stringify({
      type: "waiting",
      message: "Please wait in the lobby.",
      patientId,
    })
  );

  if (doctor) {
    doctor.send(
      JSON.stringify({
        type: "patient_request",
        patientId,
        username: patient.username,
      })
    );
  }

  if (endMeetingTimer) {
    clearTimeout(endMeetingTimer);
  }
}

function handlePatientApproval(socket, data) {
  if (doctor && doctor.id === socket.id) {
    const patient = waitingLobby.find((client) => client.id === data.patientID);
    if (patient) {
      patient.socket.send(
        JSON.stringify({
          type: "approved",
          message: "You are approved to join the meeting.",
          patientID: data.patientID,
        })
      );

      joinedPatients.push(patient);
      waitingLobby = waitingLobby.filter((client) => client !== patient);
    }
  }
}

function handlePatientRejection(socket, data) {
  if (doctor && doctor.id === socket.id) {
    const patient = waitingLobby.find((client) => client.id === data.patientID);
    if (patient) {
      patient.socket.send(
        JSON.stringify({
          type: "rejected",
          message: "You are not allowed to join the meeting.",
        })
      );

      waitingLobby = waitingLobby.filter((client) => client !== patient);
    }
  }
}
function handlePatientLeaveMeeting(socket, data) {
  const patient = joinedPatients.find((p) => p.id === data.patientId);
  if (patient) {
    joinedPatients = joinedPatients.filter((p) => p.socket.id !== patient.id);

    if (doctor) {
      doctor.send(
        JSON.stringify({
          type: "patient_leave",
          message: `Patient  left the meeting.`,
        })
      );
    } else {
      console.log("Doctor is null when patient leaves");
    }
    console.log("Disconnecting patient socket id:", patient.socket.id);
    patient.socket.disconnect(); // Ensure the patient socket is disconnected
  } else {
    console.log("Patient not found in joinedPatients:", data.patientId);
  }
}

function handleDoctorEndMeeting(socket, data) {
  const patient = joinedPatients.find((p) => p.id === data.patientID);
  if (patient) {
    patient.socket.send(
      JSON.stringify({
        type: "doctor_end_meeting",
        message: "The doctor has ended the meeting.",
      })
    );
    patient.socket.disconnect();
  }

  doctor.send(
    JSON.stringify({
      type: "doctor_end_meeting",
      message: "You have ended the meeting.",
    })
  );

  doctor.disconnect(true);
  doctor = null;
  joinedPatients = [];
  waitingLobby = [];
  meetingExpired = true;
  if (endMeetingTimer) {
    clearTimeout(endMeetingTimer);
    endMeetingTimer = null;
  }
}

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // Handle disconnection logic if needed
  });

  socket.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      switch (data.type) {
        case "join_meeting":
          if (data.role === 1) handleDoctorJoin(socket, data);
          break;
        case "waiting_lobby":
          if (data.role === 0) handlePatientJoin(socket, data);
          break;
        case "approve_patient":
          handlePatientApproval(socket, data);
          break;
        case "reject_patient":
          handlePatientRejection(socket, data);
          break;
        case "patient_leave_meeting":
          handlePatientLeaveMeeting(socket, data);
          break;
        case "doctor_end":
          handleDoctorEndMeeting(socket, data);
          break;
        default:
          console.error("Unknown message type:", data.type);
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
  console.log("Listening on *:8080");
});
