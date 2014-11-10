/**
 * The list of peer connection states.
 * - Check out the [w3 specification documentation](http://dev.w3.org/2011/
 *   webrtc/editor/webrtc.html#rtcpeerstate-enum).
 * - This is the RTCSignalingState of the peer.
 * - The states that would occur are:
 * @attribute PEER_CONNECTION_STATE
 * @type JSON
 * @param {String} STABLE There is no offer/answer exchange in progress.
 *   This is also the initial state in which case the local and remote
 *   descriptions are empty.
 * @param {String} HAVE_LOCAL_OFFER A local description, of type "offer",
 *   has been successfully applied.
 * @param {String} HAVE_REMOTE_OFFER A remote description, of type "offer",
 *   has been successfully applied.
 * @param {String} HAVE_LOCAL_PRANSWER A remote description of type "offer"
 *   has been successfully applied and a local description of type "pranswer"
 *   has been successfully applied.
 * @param {String} HAVE_REMOTE_PRANSWER A local description of type "offer"
 *   has been successfully applied and a remote description of type
 *   "pranswer" has been successfully applied.
 * @param {String} CLOSED The connection is closed.
 * @readOnly
 * @for Skylink
 * @since 0.5.0
 */
Skylink.prototype.PEER_CONNECTION_STATE = {
  STABLE: 'stable',
  HAVE_LOCAL_OFFER: 'have-local-offer',
  HAVE_REMOTE_OFFER: 'have-remote-offer',
  HAVE_LOCAL_PRANSWER: 'have-local-pranswer',
  HAVE_REMOTE_PRANSWER: 'have-remote-pranswer',
  CLOSED: 'closed'
};

/**
 * Internal array of peer connections.
 * @attribute _peerConnections
 * @type Object
 * @required
 * @private
 * @for Skylink
 * @since 0.1.0
 */
Skylink.prototype._peerConnections = [];

/**
 * We have a peer, this creates a peerconnection object to handle the call.
 * if we are the initiator, we then starts the O/A handshake.
 * @method _addPeer
 * @param {String} targetMid PeerId of the peer we should connect to.
 * @param {JSON} peerBrowser The peer browser information.
 * @param {String} peerBrowser.agent The peer browser agent.
 * @param {Integer} peerBrowser.version The peer browser version.
 * @param {Boolean} [toOffer=false] Whether we should start the O/A or wait.
 * @param {Boolean} [restartConn=false] Whether connection is restarted.
 * @param {Boolean} [receiveOnly=false] Should they only receive?
 * @private
 * @for Skylink
 * @since 0.5.4
 */
Skylink.prototype._addPeer = function(targetMid, peerBrowser, toOffer, restartConn, receiveOnly) {
  var self = this;
  if (self._peerConnections[targetMid] && !restartConn) {
    log.error([targetMid, null, null, 'Connection to peer has already been made']);
    return;
  }
  log.log([targetMid, null, null, 'Starting the connection to peer. Options provided:'], {
    peerBrowser: peerBrowser,
    toOffer: toOffer,
    receiveOnly: receiveOnly,
    enableDataChannel: self._enableDataChannel
  });
  if (!restartConn) {
    self._peerConnections[targetMid] = self._createPeerConnection(targetMid);
  }
  self._peerConnections[targetMid].receiveOnly = !!receiveOnly;
  if (!receiveOnly) {
    self._addLocalMediaStreams(targetMid);
  }
  // I'm the callee I need to make an offer
  if (toOffer) {
    if (self._enableDataChannel) {
      self._createDataChannel(targetMid);
    }
    self._doOffer(targetMid, peerBrowser);
  }
};

/**
 * Restarts a peer connection
 * @method peerId
 * @param {String} peerId PeerId of the peer to restart connection with.
 * @private
 * @since 0.5.4
 */
Skylink.prototype._restartPeerConnection = function (peerId, isSelfInitiateRestart) {
  var self = this;

  if (!self._peerConnections[peerId]) {
    log.error([peerId, null, null, 'Peer does not have an existing ' +
      'connection. Unable to restart']);
    return;
  }
  log.log([peerId, null, null, 'Restarting a peer connection']);
  // get the value of receiveOnly
  var receiveOnly = !!self._peerConnections[peerId].receiveOnly;

  // close the peer connection and remove the reference
  self._peerConnections[peerId].close();

  if (isSelfInitiateRestart) {
    var pc = self._peerConnections[peerId];
    var checkIfConnectionClosed = setInterval(function () {
      // check if the datachannel and ice connection state is closed before removing all references
      // onclose in the datachannel, it is removed
      if (pc.iceConnectionState === self.ICE_CONNECTION_STATE.CLOSED &&
        !self._dataChannels[peerId]) {
        clearInterval(checkIfConnectionClosed);
        console.info(pc);
        // delete the reference in the peerConnections array and dataChannels array
        delete self._peerConnections[peerId];
        delete self._dataChannels[peerId];

        // start the reference of peer connection
        // wait for peer connection ice connection to be closed and datachannel state too
        self._peerConnections[peerId] = self._createPeerConnection(peerId);
        self._peerConnections[peerId].receiveOnly = receiveOnly;

        if (!receiveOnly) {
          self._addLocalMediaStreams(peerId);
        }

        // NOTE: we might do checks if peer has been removed successfully
        self._sendChannelMessage({
          type: self._SIG_MESSAGE_TYPE.WELCOME,
          mid: self._user.sid,
          rid: self._room.id,
          agent: window.webrtcDetectedBrowser,
          version: window.webrtcDetectedVersion,
          userInfo: self._user.info,
          target: peerId,
          weight: -2
        });
      }
    }, 10);
  } else {
    delete self._peerConnections;
    delete self._dataChannels[peerId];
    self._peerConnections[peerId] = self._createPeerConnection(peerId);
  }
  self._trigger('peerRestart', peerId, self._peerInformations[peerId] ||
    {}, !!isSelfInitiateRestart);
};

/**
 * Actually clean the peerconnection and trigger an event.
 * Can be called by _byHandler and leaveRoom.
 * @method _removePeer
 * @param {String} peerId PeerId of the peer that has left.
 * @trigger peerLeft
 * @private
 * @for Skylink
 * @since 0.5.2
 */
Skylink.prototype._removePeer = function(peerId) {
  if (peerId !== 'MCU') {
    this._trigger('peerLeft', peerId, this._peerInformations[peerId], false);
  } else {
    log.log([peerId, null, null, 'MCU has stopped listening and left']);
  }
  if (this._peerConnections[peerId]) {
    this._peerConnections[peerId].close();
    delete this._peerConnections[peerId];
  }
  if (this._peerHSPriorities[peerId]) {
    delete this._peerHSPriorities[peerId];
  }
  if (this._peerInformations[peerId]) {
    delete this._peerInformations[peerId];
  }
  log.log([peerId, null, null, 'Successfully removed peer']);
};

/**
 * Creates a peerconnection to communicate with the peer whose ID is 'targetMid'.
 * All the peerconnection callbacks are set up here. This is a quite central piece.
 * @method _createPeerConnection
 * @param {String} targetMid
 * @return {Object} The created peer connection object.
 * @private
 * @for Skylink
 * @since 0.5.1
 */
Skylink.prototype._createPeerConnection = function(targetMid) {
  var pc, self = this;
  try {
    pc = new window.RTCPeerConnection(
      self._room.connection.peerConfig,
      self._room.connection.peerConstraints);
    log.info([targetMid, null, null, 'Created peer connection']);
    log.debug([targetMid, null, null, 'Peer connection config:'],
      self._room.connection.peerConfig);
    log.debug([targetMid, null, null, 'Peer connection constraints:'],
      self._room.connection.peerConstraints);
  } catch (error) {
    log.error([targetMid, null, null, 'Failed creating peer connection:'], error);
    return null;
  }
  // attributes (added on by Temasys)
  pc.setOffer = '';
  pc.setAnswer = '';
  // callbacks
  // standard not implemented: onnegotiationneeded,
  pc.ondatachannel = function(event) {
    var dc = event.channel || event;
    log.debug([targetMid, 'RTCDataChannel', dc.label, 'Received datachannel ->'], dc);
    if (self._enableDataChannel) {
      self._createDataChannel(targetMid, dc);
    } else {
      log.warn([targetMid, 'RTCDataChannel', dc.label, 'Not adding datachannel']);
    }
  };
  pc.onaddstream = function(event) {
    self._onRemoteStreamAdded(targetMid, event);
  };
  pc.onicecandidate = function(event) {
    log.debug([targetMid, 'RTCIceCandidate', null, 'Ice candidate generated ->'],
      event.candidate);
    //self._onIceCandidate(targetMid, event);
  };
  pc.oniceconnectionstatechange = function(evt) {
    checkIceConnectionState(targetMid, pc.iceConnectionState,
      function(iceConnectionState) {
      log.debug([targetMid, 'RTCIceConnectionState', null,
        'Ice connection state changed ->'], iceConnectionState);
      self._trigger('iceConnectionState', iceConnectionState, targetMid);

      // clear all peer connection health check
      if (iceConnectionState === self.ICE_CONNECTION_STATE.COMPLETED) {
        log.debug([targetMid, 'PeerConnectionHealth', null,
          'Peer connection with user is stable']);
        // peer connection is stable. now if there is a waiting check on it
        // do remove
        if (self._peerConnectionTimestamps[targetMid]) {
          log.debug([targetMid, 'PeerConnectionHealth', null,
            'Removing peer connection timestamp reference']);
          delete self._peerConnectionTimestamps[targetMid];
        }
      }

      /**** SJS-53: Revert of commit ******
      // resend if failed
      if (iceConnectionState === self.ICE_CONNECTION_STATE.FAILED) {
        log.debug([targetMid, 'RTCIceConnectionState', null,
          'Ice connection state failed. Re-negotiating connection']);
        self._removePeer(targetMid);
        self._sendChannelMessage({
          type: self._SIG_MESSAGE_TYPE.WELCOME,
          mid: self._user.sid,
          rid: self._room.id,
          agent: window.webrtcDetectedBrowser,
          version: window.webrtcDetectedVersion,
          userInfo: self._user.info,
          target: targetMid,
          restartNego: true,
          hsPriority: -1
        });
      } *****/
    });
  };
  // pc.onremovestream = function () {
  //   self._onRemoteStreamRemoved(targetMid);
  // };
  pc.onsignalingstatechange = function() {
    log.debug([targetMid, 'RTCSignalingState', null,
      'Peer connection state changed ->'], pc.signalingState);
    self._trigger('peerConnectionState', pc.signalingState, targetMid);
  };
  pc.onicegatheringstatechange = function() {
    log.log([targetMid, 'RTCIceGatheringState', null,
      'Ice gathering state changed ->'], pc.iceGatheringState);
    self._trigger('candidateGenerationState', pc.iceGatheringState, targetMid);
  };
  return pc;
};

/**
 * Restarts a peer connection.
 * - This only works when the connection with the peer has been established.
 * @method restartConnection
 * @param {String} peerId The peerId of the peer whose connection you wish to restart with.
 * @since 0.5.4
 */
Skylink.prototype.restartConnection = function(peerId) {
  if (!this._peerConnections[peerId]) {
    log.error([peerId, null, null, 'There is currently no existing peer connection made ' +
      'with the peer. Unable to restart connection']);
    return;
  }
  // do a hard reset on variable object
  this._peerConnections[peerId] = this._restartPeerConnection(peerId, true);
};