#! /bin/sh

echo "Downloading Node PPA.."
curl -sL https://deb.nodesource.com/setup_0.12 | sudo bash -
echo "Installing Node.."
sudo apt-get install -y nodejs
echo "Installing audio dependency for Bellboy.."
sudo apt-get install libasound2-dev # For audio support
echo "CDing into /home/pi.."
cd /home/pi
echo "Cloning Bellboy into /home/pi.."
git clone -b beta http://github.com/Grayda/bellboy.git
cd /home/pi/bellboy
echo "Installing nodemon globally.."
sudo npm install -g nodemon
echo "Installing other dependencies.."
npm install
echo "Adding script to startup.."
sudo sed -i -e '$i \nodemon /home/pi/bellboy/index.js &\n' /etc/rc.local
read -p "Press [Enter] key to reboot.."
