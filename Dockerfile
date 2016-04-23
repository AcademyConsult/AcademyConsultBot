FROM node
MAINTAINER Roman Anasal <roman.anasal@academyconsult.de>

WORKDIR /app/

COPY main.js unifi.js package.json /app/
RUN npm install

CMD npm start
