#!/usr/bin/env node
try {
  var solcInstance = require('solc');
} catch(e){
  fallbackContractMode = true;
  console.error('solc module not found/error ',e);
}
var erisC = require('eris-contracts');
var erisDb = require('eris-db');
var stdio = require('stdio');
var request = require('request');
var fs = require('fs');
var path = require('path');
var ethUtil = require('ethereumjs-util');
var bs58 = require('bs58');

var BRIDGE_VERSION = require('./package.json').version;

var edb;

var oraclizeC = '',
    oraclizeOAR = '',
    contract,
    defaultnode = 'localhost:1337',
    url = '',
    listenOnlyMode = false,
    privateKey = '',
    addressNonce = '',
    myIdList = [],
    fallbackContractMode = false,
    mainAccount,
    defaultGas = 3000000;

var ops = stdio.getopt({
    'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
    'url': {key: 'u', args: 1, description: 'eris node URL (default: http://'+defaultnode+')'},
    'HOST': {key: 'H', args: 1, description: 'eris node IP:PORT (default: '+defaultnode+')'},
    'port': {key: 'p', args: 1, description: 'eris node localhost port (default: 1337)'},
    'address': {key: 'a', args: 1, description: 'unlocked address or index used to deploy Oraclize connector and OAR'},
    'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
    'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei) (default: '+defaultGas+')'},
    'key': {args: 1, description: 'JSON key file path (default: current folder key.json)'},
    'accounts': {args: 1, description: 'JSON accounts.json data file path', mandatory: true},
    'nocomp': {description: 'disable contracts compilation'},
    'forcecomp': {description: 'force contracts compilation'},
    'loadabi': {description: 'Load default abi interface (under ethereum-bridge/contracts/abi)'}
});

if(ops.broadcast){
  throw new Error('broadcast mode is not available at the moment');
}

if(ops.gas){
  if(ops.gas<1970000){
    throw new Error('Gas amount lower than 1970000 is not allowed');
  } else if(ops.gas>4700000){
    throw new Error('Gas amount bigger than 4700000 is not allowed');
  } else {
    defaultGas = ops.gas;
  }
}

if(ops.HOST){
  var hostIPPORT = (ops.HOST).trim();
  if(hostIPPORT.indexOf(':')===-1) {
    throw new Error('Error, port missing');
  } else {
    defaultnode = hostIPPORT;
  }
}

if(ops.port){
  var hostPort = (ops.port).trim();
  defaultnode = 'localhost:'+hostPort;
}

if(ops.url){
  url = ops.url;
}

if(!ops.address && !ops.broadcast && ops.address!=-1 && !ops.accounts){
  throw new Error('script started with no option, please choose your chain accouts.json file with --accounts');
}

// contracts var
var OCsource,
    dataC,
    abiOraclize,
    OARsource,
    dataB,
    abi;

function loadContracts(){
  try {
    compileContracts();
  } catch (e){
    console.log(e);
    fallbackContracts();
  }
}

function fallbackContracts(){
  if(!ops.oar){
    console.log('Deploying contracts already pre-compiled (solc version not found/invalid)');
    fallbackContractMode = true;
  }
  OCsource = fs.readFileSync(path.join(__dirname, '../contracts/binary/oraclizeConnector.binary')).toString();
  abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/abi/oraclizeConnector.json')).toString());
  dataC = OCsource;

  OARsource = fs.readFileSync(path.join(__dirname, '../contracts/binary/addressResolver.binary')).toString();
  abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/abi/addressResolver.json')).toString());
  dataB = OARsource;
}

function compileContracts(){
  if(!fallbackContractMode){
    try {
      OCsource = fs.readFileSync(path.join(__dirname, '../contracts/ethereum-api/connectors/oraclizeConnector.sol')).toString();
      var cbLine = OCsource.match(/\+?(cbAddress = 0x.*)\;/i)[0];
      OCsource = OCsource.replace(cbLine,'cbAddress = 0x'+mainAccount+';');
      var compiledConnector = solcInstance.compile(OCsource, 1).contracts;
      dataC = compiledConnector['Oraclize'] || compiledConnector;
      var connectorObj = dataC;
      dataC = dataC['bytecode'];

      OARsource = fs.readFileSync(path.join(__dirname, '../contracts/ethereum-api/connectors/addressResolver.sol')).toString();
      var compiledOAR = solcInstance.compile(OARsource,1).contracts;
      dataB = compiledOAR['OraclizeAddrResolver'] || compiledOAR;
      var oarObj = dataB;
      dataB = dataB['bytecode'];
      if(ops.loadabi){
        abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/abi/oraclizeConnector.json')).toString());
        abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/abi/addressResolver.json')).toString());
      } else {
        abiOraclize = JSON.parse(connectorObj['interface']);
        abi = JSON.parse(oarObj['interface']);
      }
    } catch(e){
      if(e.code==='ENOENT'){
        throw new Error('Contracts file not found,\nDid your run git clone --recursive ?');
      } else throw e;
    }
  }
}

defaultnode = (url!='') ? url : 'http://'+defaultnode+'/rpc';

var contractManager;
if(ops.accounts && ops.address){
  var accountData = JSON.parse(fs.readFileSync(ops.accounts).toString());
  var accountIndex = ops.address;
  if(parseInt(accountIndex)>=0){
    accountData = accountData[Object.keys(accountData)[accountIndex]];
  } else {
    accountData = accountData[accountIndex];
  }
  mainAccount = accountData['address'];
  console.log('Using '+mainAccount+' to act as Oraclize, make sure it is unlocked and do not use the same address to deploy your contracts');

  contractManager = erisC.newContractManagerDev(defaultnode,accountData);
}

connectToErisDb();

if(ops.address && !ops.broadcast && !ops.accounts){
  var addressUser = ops.address;
  if(ethUtil.isValidAddress(ethUtil.addHexPrefix(addressUser))){
    console.log('Using '+addressUser+' to act as Oraclize, make sure it is unlocked and do not use the same address to deploy your contracts');
    mainAccount = addressUser;
  } else {
    if(addressUser==-1){
        listenOnlyMode = true;
        console.log("*** Listen only mode");
    } else {
        if(addressUser>=0 && addressUser<1000){
        /* // DISABLE getAccounts method, deploy requires unsafe methods
          mainAccount = getAccounts[addressUser];
          console.log('Using '+mainAccount+' to act as Oraclize, make sure it is unlocked and do not use the same address to deploy your contracts');
        */
        } else {
          throw new Error('Error, address is not valid');
        }
        throw new Error('--accounts /to/my/chain/path/accounts.json is required');
    }
  }
} else if(ops.broadcast) {
  throw new Error("broadcast mode not available");
}


if(ops.forcecomp){
  compileContracts();
} else {
  if(ops.oar && ops.loadabi){
      abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../contracts/abi/oraclizeConnector.json')).toString());
      abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/abi/addressResolver.json')).toString());
  } else {
    if(!listenOnlyMode && !ops.nocomp){
      loadContracts();
    } else if(!listenOnlyMode && ops.nocomp) fallbackContracts();
  }
}


if(ops.oar){
  var addressOAR = (ops.oar).trim();
  if(addressOAR.length>=1){
    if(ethUtil.isValidAddress(ethUtil.addHexPrefix(addressOAR))){
      // is valid
      oraclizeOAR = addressOAR.replace('0x','');
      console.log('OAR Address: 0x'+oraclizeOAR);
      console.log('Make sure you have this line in your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI(0x'+oraclizeOAR+');\n\n');
      if(!listenOnlyMode) runLog();
    } else {
      throw new Error('The address provided is not valid');
    }
  }
} else {
  if(!listenOnlyMode){
    generateOraclize();
  }
}

if(listenOnlyMode && ops.oar && ops.loadabi){
  runLog();
} else {
    if(listenOnlyMode){
      throw new Error('Listen only mode require the oar and abi path');
    }
}

function connectToErisDb(){
  console.log('eris node: '+defaultnode);
  console.log('Please wait...\n');
  edb = erisDb.createInstance(defaultnode);
}

var oraclizeFactory;
function generateOraclize(){
  edb.accounts().getAccount(mainAccount,function(err,res){
    var balance = res.balance;
    if(balance<25){
      console.log("\n"+mainAccount+" doesn't have enough funds to cover transaction costs, please send at least 25 tokens");
      function checkFunds(){
        edb.accounts().getAccount(mainAccount,function(err,res){
          var balance = res.balance;
          if(balance<25){
            setTimeout(checkFunds,2500);
          } else {
            console.log('Deploying contracts, received '+balance+' tokens');
            generateOraclize();
          }
        });
      };
      checkFunds();
    } else {
      if(ops.address && !ops.broadcast){
        oraclizeFactory = contractManager.newContractFactory(abiOraclize);
        contract = oraclizeFactory.new({from:mainAccount,data:dataC,gas:defaultGas}, function(e, contract){
          if(e) console.log(e);
          if (typeof contract.address != 'undefined') {
            oraclizeC = contract.address;
            if(fallbackContractMode){
              contract.setCBaddress('0x'+mainAccount,{from:mainAccount,gas:defaultGas}, function(e, tx){
                OARgenerate();
              });
            } else OARgenerate();
          }
         });
      }
    }
  });
}

var oraclizeARFactory;
function OARgenerate(){
  if(ops.address && !ops.broadcast){
    oraclizeARFactory = contractManager.newContractFactory(abi);
    var contractOAR = oraclizeARFactory.new({from:mainAccount,data:dataB,gas:defaultGas}, function(e, contract){
      if (typeof contract.address != 'undefined') {
        oraclizeOAR = contract.address;
        contract.setAddr('0x'+oraclizeC, {from:mainAccount,gas:defaultGas}, function(e, tx){
          console.log('Generated OAR Address: '+oraclizeOAR);
          console.log('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+'0x'+oraclizeOAR.toLowerCase().replace('0x','')+');\n\n');
          runLog();
        });
      }
    });
  }
}

function createQuery(query, callback){
  request.post('https://api.oraclize.it/v1/query/create', {body: query, json: true, headers: { 'User-Agent': 'eris-bridge/'+BRIDGE_VERSION+' (nodejs)' }}, function (error, response, body) {
    if (error) console.error(error);
    if (response.statusCode == 200) {
      callback(body);
    } else console.error("UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ERIS-BRIDGE");
  });
}

function checkQueryStatus(query_id, callback){
  request.get('https://api.oraclize.it/v1/query/'+query_id+'/status', {json: true, headers: { 'User-Agent': 'eris-bridge/'+BRIDGE_VERSION+' (nodejs)' }}, function (error, response, body) {
    if (error) console.error(error);
    if (response.statusCode == 200) {
      callback(body);
    } else console.error("UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ERIS-BRIDGE");
  });
}


function runLog(){
  if(typeof(contract)=="undefined"){
    oraclizeC = contractManager.newContractFactory(abi).at(oraclizeOAR).getAddress(function(err,res){
      if(typeof(res)=='undefined'){
        throw new Error("Oraclize Connector not found, make sure you entered the correct OAR");
      }
      oraclizeC = res;
      oraclizeC = ethUtil.unpad(oraclizeC);
      contract = contractManager.newContractFactory(abiOraclize).at(oraclizeC);
      listenForEvents(contract,oraclizeC);
    });
  }

  function listenForEvents(contract,oraclizeC){
    contract.Log1(startEv,newLog1);
    contract.Log2(startEv2,newLog2);

    function startEv(err,res){
            if(err) throw new Error(err);
    }
    function startEv2(err,res){
            if(err) throw new Error(err);
            console.log('Listening @ 0x'+oraclizeC.toLowerCase()+' (Oraclize Connector)\n');
    }

    function newLog1(err,data){
      console.log(JSON.stringify(data));
            if(err) console.log(err);
            else handleLog(data);
    }

    function newLog2(err,data){
      console.log(JSON.stringify(data));
            if(err) console.log(err);
            else handleLog(data);
    }
  }

    function handleLog(data){
      var counter = 0;
      data = data['args'];
      var myIdInitial = ethUtil.stripHexPrefix(data['cid']);
      myIdList[myIdInitial] = false;
      var myid = myIdInitial;
      var cAddr = ethUtil.unpad(data['sender']);
      var ds = data['datasource'];
      if(typeof(data['arg']) != 'undefined'){
        var formula = data['arg'];
      } else {
        var arg2formula = data['arg2'];
        var formula = [data['arg1'],arg2formula];
      }
      var time = parseInt(data['timestamp']);
      var gasLimit = data['gaslimit'];
      var proofType = ethUtil.stripHexPrefix(data['proofType']);
      var query = {
          when: time,
          datasource: ds,
          query: formula,
          proof_type: parseInt('0x'+proofType)
      };
      console.log(formula);

        console.log(JSON.stringify(query));
        if(!myIdList[myIdInitial] && counter>0 || myIdList[myIdInitial]) return;
        createQuery(query, function(data){
          counter++;
          console.log("Query : "+JSON.stringify(data)); 
          myid = data.result.id;
          console.log("New query created, id: "+myid);
          console.log("Checking query status every 5 seconds..");
          var interval = setInterval(function(){
            // check query status
            checkQueryStatus(myid, function(data){ console.log("Query result: "+JSON.stringify(data));  
              if(data.result.checks==null) return; 
              var last_check = data.result.checks[data.result.checks.length-1];
              var query_result = last_check.results[last_check.results.length-1];
              var dataRes = query_result;
              var dataProof = data.result.checks[data.result.checks.length-1]['proofs'][0];
              if (!last_check.success) return;
              else clearInterval(interval);
              if(dataProof==null && proofType!='00'){
                dataProof = new Buffer('None');
              }
              queryComplete(gasLimit, myIdInitial, dataRes, dataProof, cAddr);
            });
                  
          }, 5*1000);
        });
    }
}

function queryComplete(gasLimit, myid, result, proof, contractAddr){
  if(myIdList[myid]) return;
  if(!listenOnlyMode){
    if(proof==null){
      if(ops.address && !ops.broadcast){
        var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
        contractManager.newContractFactory(callbackDefinition).at(ethUtil.stripHexPrefix(contractAddr)).__callback(myid,result,{from:mainAccount,gas:gasLimit,value:0}, function(e, contract){
          if(e){
            console.log(e);
          }
          myIdList[myid] = true;
        });
      }
    } else {
      var inputProof = (proof.length==46) ? bs58.decode(proof) : proof;
      if(ops.address && !ops.broadcast){
        var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"},{"name":"proof","type":"bytes"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
        contractManager.newContractFactory(callbackDefinition).at(ethUtil.stripHexPrefix(contractAddr)).__callback(myid,result,inputProof,{from:mainAccount,gas:gasLimit,value:0}, function(e, contract){
          if(e){
            console.log(e);
          }
          myIdList[myid] = true;
        });
      }
      console.log('proof: '+proof);
    }
  }
  console.log('myid: '+myid);
  console.log('result: '+result);
  (!listenOnlyMode) ? console.log('Contract '+contractAddr+ ' __callback called') : console.log('Contract __callback not called (listen only mode)');
}
