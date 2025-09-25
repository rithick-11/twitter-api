const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('server is running at http://localhost:3000/')
    })
  } catch (err) {
    console.log(`Error on data base ${err}`)
    process.exit(1)
  }
}
initializeDbAndServer()

app.post('/register/', async (req, res) => {
  const {username, password, name, gender} = req.body
  const findUser = await db.get(
    `SELECT * FROM user WHERE username = '${username}';`,
  )
  console.log(findUser)
  if (findUser === undefined) {
    if (password.length <= 6) {
      res.status(400)
      res.send('User already exists')
    } else {
      const encryptedPassword = await bcrypt.hash(password, 10)
      console.log(encryptedPassword)
      const createUserQuery = `
      INSERT INTO
        user(name, username, password, gender)
      VALUES
        ('${name}', '${username}', '${encryptedPassword}', '${gender}');
      `
      await db.run(createUserQuery)
      res.send('User created successfully')
    }
  } else {
    res.status(400)
    res.send('User already exists')
  }
})

app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const findUser = await db.get(
    `SELECT * FROM user WHERE username = '${username}';`,
  )
  if (findUser !== undefined) {
    const verifyPassword = await bcrypt.compare(password, findUser.password)
    if (verifyPassword) {
      const jwtToken = jwt.sign({username: username}, 'Rithick')
      res.send({jwtToken})
    } else {
      res.status(400)
      res.send('Invalid password')
    }
  } else {
    res.status(400)
    res.send('Invalid user')
  }
})

const authentication = (req, res, next) => {
  let jwtToken
  const authorHead = req.headers['authorization']
  if (authorHead !== undefined) {
    jwtToken = authorHead.split(' ')[1]
  } else {
    res.status(401)
    res.send('Invalid JWT Token')
  }
  jwt.verify(jwtToken, 'Rithick', (err, payload) => {
    if (err) {
      res.status(401)
      res.send('Invalid JWT Token')
    } else {
      req.username = payload.username
      next()
    }
  })
}

const dataFromUser = async (req, res, next) => {
  let logInUser = await db.get(
    `SELECT * FROM user WHERE username = '${req.username}' ;`,
  )
  const followerTable = await db.all(
    `SELECT * FROM follower WHERE follower_user_id = '${logInUser.user_id}'`,
  )
  const followingAccount = await db.all(
    `SELECT * FROM user WHERE user_id in (SELECT following_user_id FROM follower WHERE follower_user_id = '${logInUser.user_id}')`,
  )
  const folloingTweet = await db.all(
    `SELECT * FROM tweet WHERE user_id in (SELECT following_user_id FROM follower WHERE follower_user_id = '${logInUser.user_id}')`,
  )
  const followerAccount = await db.all(
    `SELECT follower_user_id FROM follower WHERE following_user_id = '${logInUser.user_id}'`,
  )
  const userTweets = await db.all(
    `SELECT * FROM tweet WHERE user_id = ${logInUser.user_id}`,
  )
  const userTweetsId = userTweets.map(each => each.tweet_id)

  const followerList = followerAccount.map(each => each.follower_user_id)
  const folloingList = followingAccount.map(each => each.user_id)

  const tweetIdList = folloingTweet.map(each => each.tweet_id)
  req.userId = logInUser.user_id
  req.userData = {
    logInUser,
    followingAccount,
    folloingList,
    followerList,
    tweetIdList,
    userTweetsId,
  }
  next()
}

app.get(
  '/user/tweets/feed/',
  authentication,
  dataFromUser,
  async (req, res) => {
    const {folloingList} = req.userData
    const getTweetQuery = `
    SELECT
      user.username as username,
      tweet.tweet as tweet,
      tweet.date_time as dateTime
    FROM
      tweet LEFT JOIN user ON tweet.user_id = user.user_id
    WHERE
      tweet.user_id in (${folloingList.join(',')})
    ORDER BY 
      date_time
    LIMIT 4;
  `
    const followingTweets = await db.all(getTweetQuery)
    res.send(followingTweets)
  },
)

app.get('/user/following/', authentication, dataFromUser, async (req, res) => {
  const {followingAccount} = req.userData
  res.send(
    followingAccount.map(each => {
      return {
        name: each.name,
      }
    }),
  )
})

app.get('/user/followers/', authentication, dataFromUser, async (req, res) => {
  const {followerList} = req.userData
  const followerAcc = await db.all(
    `SELECT name from user where user_id in (${followerList.join(',')})`,
  )
  res.send(followerAcc)
})

app.get('/tweets/:tweetId/', authentication, dataFromUser, async (req, res) => {
  const {tweetId} = req.params
  const {tweetIdList} = req.userData
  if (tweetIdList.includes(parseInt(tweetId))) {
    const countOfLike = await db.get(
      `SELECT COUNT() as count FROM like WHERE tweet_id = ${tweetId}`,
    )
    const countOfReplies = await db.get(
      `SELECT COUNT() as count FROM reply WHERE tweet_id = ${tweetId}`,
    )
    const tweet = await db.get(
      `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`,
    )
    const response = {
      tweet: tweet.tweet,
      likes: countOfLike.count,
      replies: countOfReplies.count,
      dateTime: tweet.date_time,
    }
    res.send(response)
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes',
  authentication,
  dataFromUser,
  async (req, res) => {
    const {tweetId} = req.params
    const {tweetIdList} = req.userData
    if (tweetIdList.includes(parseInt(tweetId))) {
      const likedUserQuery = `
    SELECT
      username
    FROM
      user
    WHERE
      user_id IN (
        SELECT
          user_id
        FROM
          like
        WHERE
          tweet_id = ${tweetId}
      )
    ;
    `
      const likedUserData = await db.all(likedUserQuery)
      const response = {
        likes: likedUserData.map(each => each.username),
      }
      res.send(response)
    } else {
      res.status(401)
      res.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  dataFromUser,
  async (req, res) => {
    const {tweetId} = req.params
    const {tweetIdList} = req.userData
    if (tweetIdList.includes(parseInt(tweetId))) {
      const replyedUserQuery = `
    SELECT
      user.name as name,
      reply.reply as reply
    FROM
      user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE
      reply.tweet_id = ${tweetId}
    ;
    `
      const replyedUserData = await db.all(replyedUserQuery)
      const response = {
        replies: replyedUserData,
      }
      res.send(response)
    } else {
      res.status(401)
      res.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authentication, dataFromUser, async (req, res) => {
  const {username, userId} = req
  const getUserTweetsQuery = `
  SELECT
    tweet.tweet as tweet,
    COUNT(like.like_id) as likes,
    COUNT(reply.reply_id) as replies,
    tweet.date_time as dateTime
  FROM
    tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE
    tweet.user_id = ${userId}
  GROUP BY
    tweet.tweet_id
  `
  const response = await db.all(getUserTweetsQuery)
  res.send(response)
})

app.post('/user/tweets/', authentication, dataFromUser, async (req, res) => {
  const {tweet} = req.body
  const {userId} = req
  const currentDate = new Date()
  const createTweetQuery = `
  INSERT INTO
    tweet(tweet, user_id, date_time)
  VALUES
    ('${tweet}', ${userId}, '${currentDate}');
  `
  await db.run(createTweetQuery)
  res.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authentication,
  dataFromUser,
  async (req, res) => {
    const {userTweetsId} = req.userData
    const {tweetId} = req.params
    if (userTweetsId.includes(parseInt(tweetId))) {
      const deleteQuery = `
      DELETE FROM
        tweet
      WHERE
        tweet_id = ${tweetId};
      `
      await db.run(deleteQuery)
      res.send('Tweet Removed')
    } else {
      res.status(401)
      res.send('Invalid Request')
    }
  },
)

module.exports = app
