var net = require('net');
var dns = require('dns');

var proxyConf = {
    port: 80,
    listenHost: '0.0.0.0'
};

var proxy = net.createServer(function(client) {
    console.log('Client connected');
    var clientConnected = true;
    var serverConnected = false;
    var serverConnecting = false;
    var sendBuf = '';
    var server = null;
    client.on('data', function(chunk) {
        if (serverConnected)
            server.write(chunk);
        else {
            sendBuf += chunk;

            if (!serverConnecting) {
                var host_matches = sendBuf.match(/\r\nHost:(.*)\r\n/i);
                if (!host_matches) {
                    if (/\r\n\r\n/.test(sendBuf)) {
                        client.destroy();
                        console.log('Client did not send Host in HTTP header');
                    }
                    return;
                }
                var host = host_matches[1].trim();
                if (host == "") {
                    client.destroy();
                    console.log('Invalid Host in HTTP header');
                    return;
                }

                serverConnecting = true;
                dns.resolve4(host, function(err, addresses) {
                    if (err || addresses.length < 1) {
                        console.log('Failed to resolve ' + host);
                        client.destroy();
                        return;
                    }
                    server = net.connect({host: host, port: 80}, function() {
                        console.log('Server ' + host + ' connected');
                        serverConnected = true;
                        if (sendBuf)
                            server.write(sendBuf);
                        if (!clientConnected)
                            server.destroy();
                    });
                    server.on('data', function(chunk) {
                        if (clientConnected)
                            client.write(chunk);
                        else
                            server.destroy();
                    });
                    server.on('close', function(had_error) {
                        console.log('Server closed ' + (had_error ? 'unexpectedly' : 'normally'));
                        if (clientConnected)
                            client.destroy();
                        serverConnected = false;
                    });
                    server.on('error', function(err) {
                        console.log('Server error: ' + err);
                    });
                });
            }
        }
    });
    client.on('close', function(had_error) {
        console.log('Client closed ' + (had_error ? 'unexpectedly' : 'normally'));
        if (serverConnected) {
            if (sendBuf)
                server.write(sendBuf);
            server.destroy();
        }
        clientConnected = false;
    });
    client.on('error', function(err) {
        console.log('Client error: ' + err);
    });
});

proxy.listen(proxyConf.port, proxyConf.listenHost, function(){
    console.log('Proxy listening on ' + proxyConf.listenHost + ':' + proxyConf.port);
});
