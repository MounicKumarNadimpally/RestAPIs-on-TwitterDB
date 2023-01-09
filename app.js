const express = require("express");
const app = express();
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server and DB connected");
    });
  } catch (e) {
    console.log(`Error opening DB with message: ${e.message}`);
    process.exit(-1);
  }
};

initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

// API 1

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  console.log(username, name, password, gender);
  if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(request.body.password, 10);
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
    const dbUser = await db.get(selectUserQuery);

    if (dbUser === undefined) {
      const createUserQuery = `
              INSERT INTO
                  user (name,username, password, gender)
              VALUES
                  (
                  '${name}',
                  '${username}',
                  '${hashedPassword}',
                  '${gender}'
                  );`;
      await db.run(createUserQuery);
      console.log("Hello");
      response.send(`User created successfully`);
    } else {
      response.status(400);
      response.send("User already exists");
    }
  }
});

// API 2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPassword = await bcrypt.compare(password, dbUser.password);

    if (isPassword) {
      //   const payload = { username: username };
      const payload = { user: username, userId: dbUser.user_id };
      const jwtToken = await jwt.sign(payload, "MY_TOKEN");
      response.status(200);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const userId = request.userId;
  const query = `
     SELECT user.username AS username,T.tweet as tweet, T.date_time AS dateTime
    FROM (follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id) AS T
    INNER JOIN user ON T.user_id = user.user_id
    WHERE follower.follower_user_id = ${userId}
    ORDER BY T.date_time
    LIMIT 4;`;

  const dbResponse = await db.all(query);
  response.send(dbResponse);
});

// API 4
app.get("/user/following/", authenticateToken, async (req, res) => {
  const userId = req.userId;
  const query = `    
    SELECT user.username AS username
    FROM (follower INNER JOIN user ON follower.following_user_id = user.user_id) 
    WHERE follower.follower_user_id = ${userId};`;

  const dbResponse = await db.all(query);
  res.send(dbResponse);
});

// API 5
app.get("/user/followers/", authenticateToken, async (req, res) => {
  const userId = req.userId;
  const query = `
     SELECT user.username AS username
    FROM (follower INNER JOIN user ON follower.follower_user_id = user.user_id)
    WHERE follower.following_user_id = ${userId};`;

  const dbResponse = await db.all(query);
  res.send(dbResponse);
});

const isFollower = async (req, res, next) => {
  const userId = req.userId;
  const { tweetId } = req.params;
  const tweetCheckQuery = `
    SELECT * 
    FROM follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id
    WHERE follower.follower_user_id = ${userId} AND tweet.tweet_id = ${tweetId};`;

  const tweetCheckResponse = await db.all(tweetCheckQuery);
  if (tweetCheckResponse.length === 0) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next();
  }
};

// API 6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isFollower,
  async (req, res) => {
    const { tweetId } = req.params;
    const likesQuery = `
        SELECT tweet.tweet as tweet, count(like_id) 
        as likes, tweet.date_time AS dateTime
        FROM tweet INNER JOIN like on tweet.tweet_id = like.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const likesResponse = await db.all(likesQuery);

    const repliesQuery = `
        SELECT count(reply_id) 
        as replies
        FROM tweet INNER JOIN reply on tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const repliesResponse = await db.all(repliesQuery);

    let finalOutput = {
      tweet: likesResponse[0].tweet,
      likes: likesResponse[0].likes,
      replies: repliesResponse[0].replies,
      dateTime: likesResponse[0].dateTime,
    };
    res.send(finalOutput);
  }
);

// API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isFollower,
  async (req, res) => {
    const { tweetId } = req.params;
    const likesQuery = `
        SELECT user.username
        FROM like INNER JOIN user on like.user_id = user.user_id
        WHERE like.tweet_id = ${tweetId};`;
    const likesResponse = await db.all(likesQuery);
    const allLikes = likesResponse.map((eachUser) => eachUser.username);
    res.send({ likes: allLikes });
  }
);

// API 8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isFollower,
  async (req, res) => {
    const { tweetId } = req.params;
    const repliesQuery = `
            SELECT user.username as name, reply.reply as reply
            FROM reply INNER JOIN user on reply.user_id = user.user_id
            WHERE reply.tweet_id = ${tweetId};`;
    const repliesResponse = await db.all(repliesQuery);
    res.send({ replies: [...repliesResponse] });
  }
);

// API 9

app.get("/user/tweets/", authenticateToken, async (req, res) => {
  const userId = req.userId;

  const likesQuery = `
            SELECT tweet.tweet as tweet, count(like.like_id) as likes ,tweet.date_time as dateTime
            FROM tweet INNER JOIN like on tweet.tweet_id = like.tweet_id
            where tweet.user_id  = ${userId}
            group by tweet.tweet_id
            ORDER by tweet.date_time DESC , tweet.tweet;`;
  const likesResponse = await db.all(likesQuery);

  const repliesQuery = `
            SELECT tweet.tweet as tweet, count(reply.reply_id) as replies ,tweet.date_time as dateTime
            FROM tweet INNER JOIN reply on tweet.tweet_id = reply.tweet_id
            where tweet.user_id  = ${userId}
            group by tweet.tweet_id
            ORDER by tweet.date_time DESC, tweet.tweet;`;
  const repliesResponse = await db.all(repliesQuery);

  let tweets = [];

  for (var i = 0; i < likesResponse.length; i++) {
    tweets.push({
      tweet: likesResponse[i].tweet,
      likes: likesResponse[i].likes,
      replies: repliesResponse[i].replies,
      dateTime: likesResponse[i].dateTime,
    });
  }
  res.send(tweets);
});

// API 10
app.post("/user/tweets/", authenticateToken, async (req, res) => {
  const { tweet } = req.body;
  const userId = req.userId;
  const query = `INSERT INTO tweet (tweet, user_id)
  VALUES (
      '${tweet}',
      ${userId});`;
  res.send("Created a Tweet");
});

// API 10
const tweetCheck = async (req, res, next) => {
  const userId = req.userId;
  const { tweetId } = req.params;
  const tweetCheckQuery = `
            SELECT * 
            FROM tweet WHERE tweet.user_id = ${userId} AND tweet.tweet_id = ${tweetId}`;

  const tweetResponse = await db.all(tweetCheckQuery);

  if (tweetResponse.length === 0) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next();
  }
};
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetCheck,
  async (req, res) => {
    const { tweetId } = req.params;
    const query = `DELETE FROM tweet WHERE tweet.tweet_id =${tweetId};`;
    const queryResponse = await db.run(query);
    res.send("Tweet Removed");
  }
);

module.exports = app;
