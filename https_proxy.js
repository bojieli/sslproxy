var net = require('net');
var dns = require('dns');

var proxyConf = {
    port: 443,
    listenHost: '0.0.0.0'
};

// input: Buffer buf
// return server name as string if found
// return false if not found
// return null if invalid header or does not support SNI
function get_sni(buf) {
    /* 1   TLS_HANDSHAKE_CONTENT_TYPE
     * 1   TLS major version
     * 1   TLS minor version
     * 2   TLS Record length
     * --------------
     * 1   Handshake type
     * 3   Length
     * 2   Version
     * 32  Random
     * 1   Session ID length
     * ?   Session ID
     * 2   Cipher Suites length
     * ?   Cipher Suites
     * 1   Compression Methods length
     * ?   Compression Methods
     * 2   Extensions length
     * ---------------
     * 2   Extension data length
     * 2   Extension type (0x0000 for server_name)
     * ---------------
     * 2   server_name list length
     * 1   server_name type (0)
     * 2   server_name length
     * ?   server_name
     */
    var TLS_HEADER_LEN = 5;
    var FIXED_LENGTH_RECORDS = 38;
    var TLS_HANDSHAKE_CONTENT_TYPE = 0x16;
    var TLS_HANDSHAKE_TYPE_CLIENT_HELLO = 0x01;
    var pos = 0;

    if (buf.length < TLS_HEADER_LEN + FIXED_LENGTH_RECORDS) // not enough data
        return false;
    if ((buf[0] & 0x80) && (buf[2] == 1)) // SSL 2.0, does not support SNI
        return null;
    if (buf[0] != TLS_HANDSHAKE_CONTENT_TYPE)
        return null;
    if (buf[1] < 3) // TLS major version < 3, does not support SNI
        return null;
    var record_len = (buf[3] << 8) + buf[4] + TLS_HEADER_LEN;
    if (buf.length < record_len) // not enough data
        return false;
    if (buf[TLS_HEADER_LEN] != TLS_HANDSHAKE_TYPE_CLIENT_HELLO) // invalid handshake type
        return null;
    pos += TLS_HEADER_LEN + FIXED_LENGTH_RECORDS;

    // skip session ID
    if (pos + 1 > buf.length || pos + 1 + buf[pos] > buf.length) // not enough data
        return false;
    pos += 1 + buf[pos];
    // skip cipher suites
    if (pos + 2 > buf.length || pos + 2 + (buf[pos] << 8) + buf[pos+1] > buf.length) // not enough data
        return false;
    pos += 2 + (buf[pos] << 8) + buf[pos+1];
    // skip compression methods
    if (pos + 1 > buf.length || pos + 1 + buf[pos] > buf.length) // not enough data
        return false;
    pos += 1 + buf[pos];
    // skip extension length
    if (pos + 2 > buf.length)
        return false;
    pos += 2;

    // parse extension data
    while (true) {
        if (pos + 4 > record_len) // buffer more than one record, SNI still not found
            return null;
        if (pos + 4 > buf.length)
            return false;
        var ext_data_len = (buf[pos+2] << 8) + buf[pos+3];
        if (buf[pos] == 0 && buf[pos+1] == 0) { // server_name extension type
            pos += 4;
            if (pos + 5 > buf.length) // server_name list header
                return false;
            var server_name_len = (buf[pos+3] << 8) + buf[pos+4];
            if (pos + 5 + server_name_len > buf.length)
                return false;
            // return server_name
            return buf.slice(pos + 5, pos + 5 + server_name_len).toString();
        } else { // skip
            pos += 4 + ext_data_len;
        }
    }
}

var proxy = net.createServer(function(client) {
    console.log('Client connected');
    var clientConnected = true;
    var serverConnected = false;
    var serverConnecting = false;
    var sendBuf = null;
    var server = null;
    client.on('data', function(chunk) {
        if (serverConnected)
            server.write(chunk);
        else {
            if (sendBuf) {
                newBuf = new Buffer(sendBuf.length + chunk.length, 'hex');
                sendBuf.copy(newBuf);
                chunk.copy(newBuf, sendBuf.length);
                sendBuf = newBuf;
            } else {
                sendBuf = chunk;
            }

            if (!serverConnecting) {
                var host = get_sni(sendBuf);
                if (host === null) {
                    client.destroy();
                    console.log('Client did not send valid HTTPS header with SNI');
                    return;
                }
                if (host === false) { // no enough data, wait for next chunk
                    return;
                }

                serverConnecting = true;
                dns.resolve4(host, function(err, addresses) {
                    if (err || addresses.length < 1) {
                        console.log('Failed to resolve ' + host);
                        client.destroy();
                        return;
                    }
                    server = net.connect({host: addresses[0], port: 443}, function() {
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
