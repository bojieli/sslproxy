HTTP/HTTPS proxy
----------------

This is a demo HTTP/HTTPS proxy implemented in nodejs.

How the proxy determines the upstream server:

* HTTP proxy inspects "Host" field in HTTP request header.
* HTTPS proxy inspects "server\_name" field in SSL ClientHello message. Modern browsers with SNI (Server Name Indication) support required.

