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

function handleDoctorJoin(socket, data) {
  doctor = socket;
  doctor.sessionId = data.sessionID;

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
          message: `Patient left the meeting.`,
        })
      );
    } else {
      console.log("Doctor is null when patient leaves");
    }
    console.log("Disconnecting patient socket id:", patient.socket.id);
    patient.socket.disconnect();
  } else {
    console.log("Patient not found in joinedPatients:", data.patientId);
  }
}

function handlePatientJoinMeeting(socket, data) {
  const patientId = data.sessionID;
  const patient = { socket, id: patientId, username: data.userName };

  // Remove the existing socket for the patient if it exists
  const existingPatientIndex = joinedPatients.findIndex(
    (p) => p.id === patientId
  );
  if (existingPatientIndex !== -1) {
    const existingPatient = joinedPatients[existingPatientIndex];
    console.log(
      `Disconnecting existing patient socket id: ${existingPatient.socket.id}`
    );
    existingPatient.socket.disconnect();
    joinedPatients.splice(existingPatientIndex, 1);
  }

  // Add the new socket for the patient
  joinedPatients.push(patient);

  if (doctor) {
    doctor.send(
      JSON.stringify({
        type: "patient_joined",
        message: `${patient.username} has joined the meeting.`,
      })
    );
  }

  // Notify the patient that they have successfully joined the meeting
  socket.send(
    JSON.stringify({
      type: "joined_meeting",
      message: "You have successfully joined the meeting.",
    })
  );

  console.log(`Patient ${patient.id} joined the meeting.`);
}

function handleDoctorEndMeeting(socket) {

  if (doctor && doctor.id === socket.id) {
    const endMessage = {
      type: "doctor_end_meeting",
      message: "The doctor has ended the meeting.",
    };

    const filterJoinedPatients = joinedPatients.filter(
      (patient) => patient.socket && patient.socket.connected
    );
    filterJoinedPatients.forEach((patient) => {
      if (patient.socket.connected) {
        patient.socket.send(JSON.stringify(endMessage), (error) => {
          if (error) {
            console.error("Error sending message to patient:", error);
          } else {
            console.log("Message sent to patient:", patient.id);
          }
          patient.socket.disconnect(true);
        });
      }
    });

    joinedPatients = [];
    waitingLobby = [];
    doctor.send(JSON.stringify(endMessage));
    doctor.disconnect(true);
    doctor = null;

    if (endMeetingTimer) {
      clearTimeout(endMeetingTimer);
      endMeetingTimer = null;
    }
  }
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
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
        case "patient_join_meeting":
          handlePatientJoinMeeting(socket, data);
          break;
        default:
          console.error("Unknown message type:", data);
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
