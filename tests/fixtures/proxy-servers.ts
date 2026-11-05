import net from 'node:net';
export function socks5Server(record:(target:string)=>void){
  const server=net.createServer(client=>{
    client.once('data',handshake=>{
      if(handshake[0]!==5||!handshake.includes(0)){client.destroy();return;}
      client.write(Buffer.from([5,0]));
      client.once('data',request=>{
        if(request[1]!==1){client.destroy();return;}
        const atyp=request[3];let host:string;let offset:number;
        if(atyp===3){const len=request[4];host=request.subarray(5,5+len).toString();offset=5+len;}
        else if(atyp===1){host=[...request.subarray(4,8)].join('.');offset=8;}
        else{client.destroy();return;}
        const port=request.readUInt16BE(offset);record(`${host}:${port}`);
        const upstream=net.connect(port,host,()=>{client.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));client.pipe(upstream);upstream.pipe(client);});
        upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
      });
    });
  });
  return new Promise<{server:net.Server;port:number}>(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,port:(server.address() as net.AddressInfo).port})));
}

export function socks5AuthServer(expectedUser:string,expectedPass:string,record:(target:string)=>void){
  const server=net.createServer(client=>{
    client.once('data',handshake=>{
      if(handshake[0]!==5||!handshake.includes(2)){client.destroy();return;}
      client.write(Buffer.from([5,2]));
      client.once('data',auth=>{
        if(auth[0]!==1){client.destroy();return;}
        const ulen=auth[1];const user=auth.subarray(2,2+ulen).toString();
        const plen=auth[2+ulen];const pass=auth.subarray(3+ulen,3+ulen+plen).toString();
        if(user!==expectedUser||pass!==expectedPass){client.write(Buffer.from([1,1]));client.destroy();return;}
        client.write(Buffer.from([1,0]));
        client.once('data',request=>{
          if(request[1]!==1){client.destroy();return;}
          const atyp=request[3];let host:string;let offset:number;
          if(atyp===3){const len=request[4];host=request.subarray(5,5+len).toString();offset=5+len;}
          else if(atyp===1){host=[...request.subarray(4,8)].join('.');offset=8;}
          else{client.destroy();return;}
          const port=request.readUInt16BE(offset);record(`${host}:${port}`);
          const upstream=net.connect(port,host,()=>{client.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));client.pipe(upstream);upstream.pipe(client);});
          upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
        });
      });
    });
  });
  return new Promise<{server:net.Server;port:number}>(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,port:(server.address() as net.AddressInfo).port})));
}
