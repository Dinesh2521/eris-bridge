###Requirements
- Node 6.0.0 < 6.5.0 & npm
- eris version 0.12.0


####Note
(on Ubuntu)

run `sudo apt-get install build-essential -y`

###Install
```
npm install
```

###How to use
```
node plugin --accounts /home/user/.eris/chains/my_chain/accounts.json -a my_chain_full_000 -H localhost:1337
```
(will start the eris-bridge using the my_chain_full_000 account in the accounts.json file and connect to the eris-db at localhost:1337/rpc)


The accounts flag must point to your accounts.json active chain path


**Follow the console message**

Add `OAR = OraclizeAddrResolverI(EnterYourOarCustomAddress);` to your contract constructor, example:

**Note:** You need to change `EnterYourOarCustomAddress` with the address that is generated when you run the script
```
contract test() {
    ...
    
    function test() {
      // this is the constructor
      OAR = OraclizeAddrResolverI(0xf0f20d1a90c618163d762f9f09baa003a60adeff);
    }
  
    ...
}
```

**Note:** The address chosen will be used to deploy the Oraclize OAR and Connector, make sure to not deploy contracts that use Oraclize on the same address.

###Optional flags

* optional:
  * `-a` : change the default account used to deploy and call the transactions i.e:
    * `node plugin --accounts /home/user/.eris/chains/my_chain/accounts.json -a 0` : use account index 0 in accounts.json on localhost:1337/rpc
    * `node plugin --accounts /home/user/.eris/chains/my_chain/accounts.json -a my_test_chain_full_000` : use account 'my_test_chain_full_000' in accounts.json on localhost:1337/rpc
  * `--oar` : to specify the OAR address already deployed i.e. `node plugin --oar EnterYourOarCustomAddress`
  * `-H` : change the default eris node (localhost:1337) (/rpc is always appended)
  * `-p` : change the default PORT (1337) on localhost
  * `--gas` : change the default gas limit (3000000) used to deploy contracts
