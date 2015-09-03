var CronJob = require('cron').CronJob; // Handles the timing
var Player = require('player'); // Plays MP3s
var ejs = require('ejs'); // Text template engine, used for emails
var moment = require("moment"); // For formatting of dates
var Table = require('cli-table'); // Neatly presents data
var fs = require('fs'); // For reading files
var http = require('http'); // For our web server
var url = require("url"); // For parsing URLs
var dispatcher = require('httpdispatcher'); // For handling our web server requests

var config, bells // Our two json config files
var jobs = {} // This will hold our cron jobs

process.on('SIGUSR2', function () {
    console.log("=================================== Shutting down!")
});

start()

// Begin
function start() {
  console.log()
  console.log("Loading settings..")
  loadSettings()
  console.log("Loading bells..")
  console.log()
  // loadBells() also calls showTable()
  loadBells()
  console.log()

  // Start the web server
  startServer()

}

// Play the audio file
function playAudio(file) {
    console.log("Playing " + file)
    try {
    player = new Player("./" + file)
    player.play()
  } catch(ex) {
    
  }
}

// Sends our trigger email.
function sendEmail(item) {
  // variables that the template should have access to
  var options = {
    mail: item.TriggerEmail,
    item: item,
    Date: moment().format(config.DateFormat)
  }
  // Send the actual email.
  sendRawEmail(item.TriggerEmail.From, item.TriggerEmail.To, item.TriggerEmail.Subject, item.TriggerEmail.Body, options)
}

// Function that sends an email. SendEmail is used by it, as is the function for ChangeEmail
function sendRawEmail(from, to, subject, body, options) {
  // Take our options and parse our template
  var tBody = ejs.render(body, options)
  var tSubject = ejs.render(config.Email.SubjectPrefix + subject, options)

  // Create a new table to show what email was sent.
  var table = new Table({
    head: ['Key', 'Value'],
    style: { head: ['green', 'bold']}
  });
  table.push(
    ["Server", config.Email.Server],
    ["From", from],
    ["To", to],
    ["Subject", tSubject],
    ["Body", tBody],
    ["Time", moment().format(config.DateFormat)]

  );

  var email   = require("emailjs");
  var server  = email.server.connect({
      user:    config.Email.Username,
      password:config.Email.Password,
      host:    config.Email.Server,
      ssl:     config.Email.SSL
  });

  // send the message and get a callback with an error or details of the message that was sent
  server.send({
      text:    tBody,
      from:    from,
      to:      to,
      subject: tSubject
  }, function(err, message) { console.log(err || message); });

  // Add our details to it. / Server From


  console.log(table.toString())

}

// Starts a web server and sets up our dispatches
function startServer() {

  // Start a server and send any responses to our dispatcher
  var server = http.createServer(function(request, response){
    dispatcher.dispatch(request, response);
  });

  // When we're switching a bell on or off
  dispatcher.onGet("/toggle.html", function(req,res) {
    try {
      // Force our state to be a boolean
      var state = (req.params.state === "true")
      // Toggle the bell. Last param is a callback.
      toggleBell(req.params.id, state, function(success) {
        // If change not successful, due to job being locked
        if(success == false) {
          console.log("State NOT updated, as the job is locked")
        } else {
          // Show an updated table of our jobs
          showTable()
          // Save the updated bells
          saveBells()
        }

      // Grab the toggle.html file for updating
      file = fs.readFileSync("./web" + url.parse(req.url).pathname).toString()
      // Options the template will have access to
      var options = {
        item: bells.Bells[req.params.id],
        Date: moment().format(config.DateFormat),
        state: state,
        filename: "./web/header.html"
      }

      // Render the template and write it to our waiting client.
      res.end(ejs.render(file, options))

    })
  } catch (ex) {
    res.end("Cannot find file! " + ex)
  }
  })

  // We've requested an image. Needs to be sent in binary
  dispatcher.beforeFilter(/\.jpg|\.png|\.gif|\.bmp/g, function(req, res) {
      file = fs.readFileSync("./web" + url.parse(req.url).pathname)
      res.end(file, 'binary')
  })

  // We've requested a CSS file. Pass it the WebTheme from our config file
  dispatcher.beforeFilter(/.css/g, function(req, res) {
    var options = {
      theme: config.WebTheme,
      filename: "./web/header.html"
    }

    file = fs.readFileSync("./web" + url.parse(req.url).pathname).toString()
    res.end(ejs.render(file, options))

  })

  // Call to the root
  dispatcher.onGet("/", function(req, res) {
    file = fs.readFileSync("./web/index.html").toString()
    var options = {
      items: bells.Bells,
      Date: moment().format(config.DateFormat),
      query: req,
      filename: "./web/header.html"
    }
    res.end(ejs.render(file, options))

  });

  dispatcher.onGet("/reload.html", function(req, res) {
    loadBells()
    loadSettings()

    var options = {
      Date: moment().format(config.DateFormat),
      filename: "./web/header.html"
    }

    file = fs.readFileSync("./web/reload.html").toString()
    res.end(ejs.render(file, options))
  });

  // Not yet complete.
  dispatcher.onGet("/add.html", function(req, res) {
    file = fs.readFileSync("./web" + url.parse(req.url).pathname).toString()
    var options = {
      items: bells.Bells,
      Date: moment().format(config.DateFormat),
      query: req,
      filename: "./web/header.html"
    }
    res.end(ejs.render(file, options))

  })

  // After our setup, set our server to listen
  server.listen(config.ServerPort, function(){
      console.log("Server listening on: http://localhost:%s", config.ServerPort);
  });

}

// Sets a bell to the specified state. Supports a callback so you know when it's done.
function toggleBell(bell, state, callback) {
  // Force "locked" to be a boolean. Need to check this line in other functions, as it could be security risk
  var locked = (bells.Bells[bell].Locked === "true")
  // If the job isn't locked (meaning it can be changed via the web UI)
  if(locked == false) {
    // If state is going to be true, start the job
    if(state === true) {
      console.log("Starting Cron job for " + bell)
      jobs[bell].start()
    } else {
      // Stop the job if we're disabling it
      console.log("Stopping Cron job for " + bell)
      jobs[bell].stop()
    }
    // Set the bell. It's your responsibility to call saveBells() later
    bells.Bells[bell].Enabled = state
    console.log(bell + " is now " + bells.Bells[bell].Enabled)
    if(typeof callback === "function") { callback(true); }
  } else {
    if(typeof callback === "function") { callback(false); }
  }

}

function saveSettings() {
  fs.writeFile("./config.json", JSON.stringify(config, null, 2))
}

function loadSettings() {
  config = JSON.parse(fs.readFileSync("./config.json", 'utf8'));
}

function loadBells() {
  bells = JSON.parse(fs.readFileSync(config.BellFile, 'utf8'));



  // Loop through all the bells we have
  // Because bells.Bells uses a string based key, we have to do it this way.
  Object.keys(bells.Bells).forEach(function(item) {
    try {
      jobs[item].stop()
    } catch(ex) {

    }
        // Create a new Cron job at the specified .Time (a Cron expression)
        jobs[item] = new CronJob(bells.Bells[item].Time, function() {
              // Let us know the job has been triggered
              console.log("Triggering job: " + bells.Bells[item].Name + " at " + moment().format(config.DateFormat));
              // If we've got emails enabled for this job
              emailState = (bells.Bells[item].TriggerEmail.Enabled === "true")
              if (emailState == true) {
                console.log("Emailing Now..")
                sendEmail(bells.Bells[item])
              }

              // Actually play the audio
              playAudio(bells.Bells[item].File)
          // Replace "null" with a function() if you want something to run when the job completes. The next parameter determines
          // if the job runs now (otherwise you need to call job[key].start()), final param is timezone the job should run
        }.bind(this), null, bells.Bells[item].Enabled, config.Location);

  })

  showTable()
}

function saveBells() {
  fs.writeFile(config.BellFile, JSON.stringify(bells, null, 2))
}

function showTable() {
  var table = new Table({
    head: ['ID', 'Name', 'Description', 'Time', 'File', 'Email', 'Enabled'],
    style: { head: ['green', 'bold']}
  });

  Object.keys(bells.Bells).forEach(function(item) {

      // Add details to the table
      table.push(
        [item, bells.Bells[item].Name, bells.Bells[item].Description, bells.Bells[item].Time, bells.Bells[item].File, bells.Bells[item].TriggerEmail.Enabled, bells.Bells[item].Enabled]
      );
  })
  console.log(table.toString())
  console.log("Time is a cron expression: Minute, Hour, Day, Month, Day of the week")
  console.log()
}
