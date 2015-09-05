var path = require('path');
var kpio = require('keepass.io');
var moment = require('moment');
var util = require('util');
var Promise = require('bluebird');
var read = Promise.promisify(require('read'));

function objectLog(myObject) {
  return util.inspect(myObject, false, null);
}

Promise.promisifyAll(kpio.Database.prototype);

var indent = 0;

function EntryTitle(Entry) {
  if(Entry.Name) {
    return Entry.Name;
  }
  
  var processedEntry = Entry.String.filter(function(Entry) {
    return Entry.Key === 'Title';
  })[0];
  return processedEntry.Value;
}

function updateEntryInGroup(Group, UpdatedEntry) {
  
  var entries = (Group.Entry instanceof Array) ? Group.Entry : [Group.Entry];
  
  for(var i = 0;i < entries.length;++i) {
    if(entries[i].UUID == UpdatedEntry.UUID) {
      //console.log('FOUND ENTRY!!', 'index', i);
      entries[i] = UpdatedEntry;
      return;
    }
  }
  if (!Group.Entry) {
    Group.Entry = UpdatedEntry;
  } else if( ! (Group.Entry instanceof Array) ) {
    Group.Entry = [Group.Entry, UpdatedEntry];
  } else {
    Group.Entry.push(UpdatedEntry);
  }
}

function processRawDb(rawDatabase, onEntry) {
  var groupPath = [];
  var groups = [];
  showGroup(rawDatabase.KeePassFile.Root.Group);
  
  function showGroup(Group) {
    onEntry({
      UUID: Group.UUID,
      path: groupPath.join('/') + '/' + Group.Name,
      Group: Group,
      ParentGroup: groups[groups.length - 1]
    });
    groups.push(Group);
    groupPath.push(Group.Name);
    if(Group.Group instanceof Array) {
      Group.Group.forEach(function(Group) {
        showGroup(Group);
      });
    } else if(Group.Group) {
      showGroup(Group.Group);
    }
    
    function processEntry(Entry) {
      onEntry({
        UUID: Entry.UUID,
        path: groupPath.join('/') + '/' + EntryTitle(Entry),
        Entry: Entry,
        ParentGroup: groups[groups.length - 1]
      });
    }
    
    if(Group.Entry) {
      if(Group.Entry instanceof Array) {
        Group.Entry.forEach(processEntry);
      } else {
        processEntry(Group.Entry);
      }
    }
    groupPath.pop();
    groups.pop();
  }
}

function rawDatabaseToHash(rawDatabase) {
  var entryDb = {};
  processRawDb(rawDatabase, function(entryForDb) {
    entryDb[entryForDb.UUID] = entryForDb;
  });
  return entryDb;
}

function loadDatabase(filename, credentials) {
  var db = new kpio.Database();
  credentials.forEach(function(credential) {
    db.addCredential(credential);
  });
  return db.loadFileAsync(filename).then(function() {
    var rawDatabase = db.getRawApi().get();

    return {
      db: db,
      entryDb: rawDatabaseToHash(rawDatabase),
      rawDatabase: rawDatabase
    };
  });
}

function mergeKdbx(kdbxFrom, kdbxFromCredentials, kdbxTo, kdbxToCredentials) {
  return Promise.all([
    loadDatabase(kdbxFrom, kdbxFromCredentials),
    loadDatabase(kdbxTo, kdbxToCredentials)
  ]).spread(function(db1, db2) {
    var entryDbFrom = db1.entryDb;
    var entryDbTo = db2.entryDb;
    
    Object.keys(entryDbFrom).forEach(function(key) {
      if(!entryDbTo[key]) {
        console.log(kdbxFrom + ' has entry : ', entryDbFrom[key].path, 'which does not exist in ', kdbxTo );
        
        updateEntryInGroup(entryDbTo[entryDbFrom[key].ParentGroup.UUID].Group , entryDbFrom[key].Entry);
      } else if(entryDbTo[key].Entry) {
        
        var m1 = moment(entryDbFrom[key].Entry.Times.LastModificationTime).toDate();
        var m2 = moment(entryDbTo[key].Entry.Times.LastModificationTime).toDate();
        
        if(m1 > m2) {
          console.log(kdbxFrom + ' is newer  : ', entryDbFrom[key].path);
                    
          updateEntryInGroup(entryDbTo[key].ParentGroup, entryDbFrom[key].Entry);
        } else if(m2 > m1) {
          console.log(kdbxTo + ' is newer  : ', entryDbTo[key].path);
        }
      }
    });
    Object.keys(entryDbTo).forEach(function(key) {
      if(!entryDbFrom[key]) {
        console.log(kdbxTo + ' has entry : ', entryDbTo[key].path, 'which does not exist in ', kdbxFrom );
      }
    });
    
    db2.db.getRawApi().set(db2.rawDatabase);
    return db2.db.saveFileAsync(process.argv[4]);
  });
}

if(process.argv.length < 5) {
  return console.error('Usage: node keepass.js from.kdbx to.kdbx merged.kdbx');
}

console.log('Note: password should match both databases');
read({ prompt: 'Password: ', silent: true }).then(function(password) {
  var passwordCredential = new kpio.Credentials.Password(password[0]);
  return mergeKdbx(process.argv[2], [passwordCredential],
                  process.argv[3], [passwordCredential]);
}).catch(function(err) {
  console.error(err);
});
