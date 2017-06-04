FROM tozd/sgx:ubuntu-xenial

EXPOSE 4001/tcp
EXPOSE 4002/udp
EXPOSE 5001/tcp
EXPOSE 8080/tcp
EXPOSE 8000/tcp

VOLUME /ipfs
VOLUME /var/log/lucky
VOLUME /var/log/ipfs

COPY . /lucky

RUN wget -O - https://nodejs.org/dist/v6.10.0/node-v6.10.0-linux-x64.tar.xz | tar Jx --strip=1 -C /usr/local --anchored --exclude=node-v6.10.0-linux-x64/CHANGELOG.md --exclude=node-v6.10.0-linux-x64/LICENSE --exclude=node-v6.10.0-linux-x64/README.md && \
 wget -O - https://dist.ipfs.io/go-ipfs/v0.4.6/go-ipfs_v0.4.6_linux-amd64.tar.gz | tar zx --strip=1 -C /usr/local/bin go-ipfs/ipfs && \
 adduser --system --group lucky --home /lucky && \
 adduser --system --group ipfs --home /ipfs && \
 cd /lucky && \
 npm install && \
 make

COPY ./etc /etc
