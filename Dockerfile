FROM ubuntu:jammy

RUN rm /bin/sh && ln -s /bin/bash /bin/sh

RUN apt-get update --fix-missing
RUN apt-get install -y curl
RUN apt-get install -y build-essential libssl-dev

ENV NODE_VERSION=19.6.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"
RUN node --version
RUN npm --version

RUN apt-get update && \
    apt-get install -y apt-transport-https ca-certificates curl gnupg-agent software-properties-common && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add - && \
    add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" && \
    apt-get update && \
    apt-get install -y docker-ce-cli

RUN apt-get install -y jq

WORKDIR /chaindirect

COPY . .

ENV PATH /chaindirect/scripts:/chaindirect/scripts/hlf-bin:$PATH

RUN npm install typescript -g
RUN npm install
RUN npm run build
RUN rm -rf src
CMD [ "node", "dist/app.js" ]

# docker build -t chaindirect/chain-direct:version .
# docker run --network=host chaindirect/chain-direct:version