try {
  require("node:process").loadEnvFile()
} catch (error) {
  return;
}

const path = require("node:path");
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const { User, generateUserObject } = require("./models/User");
const fs = require("fs");
const notificationsFilePath = path.join(__dirname, "data", "notifications.json");
const predefinedTasksFilePath = path.join(__dirname, "data", "predefined-tasks.json");
const Todo = require("./models/Todo");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views/"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/public", express.static(path.join(__dirname, "public")));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

app.use(
  session({
    secret: "@##@@£",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.AUTH_DISCORD_CLIENT_ID,
      clientSecret: process.env.AUTH_DISCORD_CLIENT_SECRET,
      callbackURL: `${process.env.URL}/auth/discord/callback`,
      scope: ["identify"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ discordId: profile.id });
        if (!user) user = await User.create(generateUserObject(profile));
        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

app.get("/", (req, res) => {
  res.render("index", { user: req.user });
});

app.get("/auth/discord", passport.authenticate("discord"));

app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect("/");
  });
});

app.get("/api/notifications", (req, res) => {
  fs.readFile(notificationsFilePath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Failed to load notifications." });
    }
    try {
      const notifications = JSON.parse(data);
      res.json(notifications);
    } catch {
      res.status(500).json({ error: "Invalid notifications format." });
    }
  });
});

app.post("/api/notifications", isAuthenticated, isAdmin, (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Notification message is required." });
  }

  try {
    const data = fs.readFileSync(notificationsFilePath, "utf8");
    const notifications = JSON.parse(data);

    const newNotification = { id: Date.now(), message };
    notifications.push(newNotification);

    fs.writeFileSync(notificationsFilePath, JSON.stringify(notifications, null, 2), "utf8");

    res.status(201).json({ message: "Notification added successfully.", notification: newNotification });
  } catch {
    res.status(500).json({ error: "Failed to add notification." });
  }
});

app.delete("/api/notifications/:id", isAuthenticated, isAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const data = fs.readFileSync(notificationsFilePath, "utf8");
    let notifications = JSON.parse(data);

    const notificationIndex = notifications.findIndex((n) => n.id === parseInt(id));
    if (notificationIndex === -1) {
      return res.status(404).json({ error: "Notification not found." });
    }

    notifications.splice(notificationIndex, 1);
    fs.writeFileSync(notificationsFilePath, JSON.stringify(notifications, null, 2), "utf8");

    res.json({ message: "Notification deleted successfully." });
  } catch {
    res.status(500).json({ error: "Failed to delete notification." });
  }
});

app.get("/api/predefined", (req, res) => {
  fs.readFile(predefinedTasksFilePath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Failed to load predefined tasks." });
    }
    try {
      const predefinedTasks = JSON.parse(data);
      res.json(predefinedTasks);
    } catch {
      res.status(500).json({ error: "Invalid predefined tasks format." });
    }
  });
});

app.put("/api/predefined", async (req, res) => {
  const { title } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Task title is required." });
  }

  try {
    const data = fs.readFileSync(predefinedTasksFilePath, "utf8");
    const predefinedTasks = JSON.parse(data);

    const existingTask = predefinedTasks.find(task => task.title.toLowerCase() === title.toLowerCase());

    if (existingTask) {
      existingTask.frequency = (existingTask.frequency || 1) + 1;
    } else {
      predefinedTasks.push({ title, frequency: 1 });
    }

    const updatedTasks = predefinedTasks
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    fs.writeFileSync(predefinedTasksFilePath, JSON.stringify(updatedTasks, null, 2), "utf8");

    res.json({ message: "Predefined tasks updated successfully.", tasks: updatedTasks });
  } catch {
    res.status(500).json({ error: "Failed to update predefined tasks." });
  }
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/auth/discord");
}

function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.discordId === "1143607268781342893") {
    return next();
  }
  res.status(403).send("Access denied.");
}

app.get("/admin", isAuthenticated, isAdmin, (req, res) => {
  res.render("admin", { user: req.user });
});

app.get("/todos", isAuthenticated, async (req, res) => {
  try {
    const todos = await Todo.find({ userId: req.user.id });
    res.render("todos", { user: req.user, todos });
  } catch {
    res.status(500).send("Failed to load tasks.");
  }
});

app.get("/api/todos", isAuthenticated, async (req, res) => {
  try {
    const todos = await Todo.find({ userId: req.user.id });
    res.json(todos);
  } catch {
    res.status(500).json({ error: "Failed to fetch todos." });
  }
});

app.post("/api/todos", isAuthenticated, async (req, res) => {
  const { title, description } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required." });
  }

  try {
    const newTodo = await Todo.create({
      title,
      description,
      userId: req.user.id,
    });

    res.status(201).json(newTodo);
  } catch {
    res.status(500).json({ error: "Failed to create todo." });
  }
});

app.put("/api/todos/:id", isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { title, description, status } = req.body;

  try {
    const updatedTodo = await Todo.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { title, description, status },
      { new: true, runValidators: true }
    );

    if (!updatedTodo) {
      return res.status(404).json({ error: "Todo not found." });
    }

    res.json(updatedTodo);
  } catch {
    res.status(500).json({ error: "Failed to update todo." });
  }
});

app.delete("/api/todos/:id", isAuthenticated, async (req, res) => {
  const { id } = req.params;

  try {
    const deletedTodo = await Todo.findOneAndDelete({
      _id: id,
      userId: req.user.id,
    });

    if (!deletedTodo) {
      return res.status(404).json({ error: "Todo not found." });
    }

    res.json({ message: "Todo deleted successfully." });
  } catch {
    res.status(500).json({ error: "Failed to delete todo." });
  }
});

/*app.listen(3000, () => {
  console.log("Server is running!");
});*/

module.exports = (req, res) => {
  return app(req, res);
};
