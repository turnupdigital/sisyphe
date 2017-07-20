'use strict';

const pkg = require('../package.json');
const chai = require('chai');
const expect = chai.expect;
const Dispatcher = require('../src/dispatcher');
const Overseer = require('../src/overseer');
const Task = require('../src/task');

describe(`${pkg.name}/src/dispatcher.js`, function () {
  describe("#init", function () {
    it("should be initialized successfully", function () {
      const ventilator = Object.create(Dispatcher);
      const task = Object.create(Task);
      ventilator.init(task, {
        name: "test"
      })
      expect(ventilator.tasks).to.be.an("object");
      expect(ventilator.options).to.be.an("object");
      expect(ventilator.waitingQueue).to.be.an("array");
    });
  })

  describe("#getOverseer", function () {
    it("should return a overseer when it's ready", function (done) {
      const ventilator = Object.create(Dispatcher);
      const task = Object.create(Task);
      ventilator.init(task, {
        name: "test"
      });
      const overseer1 = Object.create(Overseer);
      overseer1.init(`${__dirname}/dumbWorker.js`);
      const overseer2 = Object.create(Overseer);
      overseer2.init(`${__dirname}/dumbWorker.js`);

      ventilator.addOverseer(overseer1);
      ventilator.getOverseer((overseer) => {
        expect(overseer).to.be.an("object");
        expect(overseer).to.have.property("send");
      });
      ventilator.getOverseer((overseer) => {
        expect(overseer).to.be.an("object");
        expect(overseer).to.have.property("send");
        done();
      });
      setTimeout(() => {
        ventilator.addOverseer(overseer2);
      }, 200)
    });
  })

  describe("#start", function () {
    it("should start and dispatch tasks", function (done) {
      const doc = Object.create(Task);
      doc.init({
        name: "test"
      });
      for (let i = 0; i < 32; i++) {
        doc.add({
          id: i,
          type: "pdf"
        });
      }

      const ventilator = Object.create(Dispatcher);
      ventilator.init(doc, {
        name: "test"
      });
      for (var i = 0; i < 4; i++) {
        const overseer = Object.create(Overseer);
        overseer.init(`${__dirname}/dumbWorker.js`);
        ventilator.addOverseer(overseer);
      }

      ventilator.start(() => {
        done();
      });
    });
  })
});