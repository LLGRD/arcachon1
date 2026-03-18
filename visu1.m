
%====================================
% [] = visu1()
%------------------------------------
% Visualisation polar log  
%------------------------------------
% Laman - 20/02/2026 - 13:30
%====================================

function [] = visu1()

pkg load image;          % Lib Image !

f = imread('visu1.png'); % vue d'ensemble
[h,w,~] = size(f);
f(1,:,3) = 255; 
f(h,:,3) = 255;
f(:,1,3) = 255; 
f(:,w,3) = 255;
F = double(f);
F = (F(1:2:end,:,:)+F(2:2:end,:,:))/2;
F = (F(:,1:2:end,:)+F(:,2:2:end,:))/2;
F = uint8(F); 
hs = h/2;
ws = w/2;
wt = 1200;
hr = 120;
G = zeros(hs-hr,wt,3);   % fenetre pol-log
J = zeros(hr,wt,3);      % BIDOUILLE ???
J(:,:,3) = 128;
r = 1:(hs-hr);
t = 2*pi*(1:wt)/wt;
[t,r] = meshgrid(t,r);   % coordonnees
a = 100;                 % x0
b = 160;                 % y0
c = 960;                 % r0
d = 0;                   % t0

yr = (1:hr) - (hr/2);
yr = flip(repmat(4*yr'+c,[1,wt]),1);
R0 = c*ones(1,wt);
J(:,:,2) = 128*double(yr<R0);
J(:,:,2) = J(:,:,2)-imerode(J(:,:,2),ones(3))/2;

c = repmat(R0,[hs-hr,1]);
x = 4*exp(4*(r+c)/h).*cos(t) + 2*a;
y = 4*exp(4*(r+c)/h).*sin(t) + 2*b;
x = min(max(round(x),1),w);
y = min(max(round(y),1),h);
u = sub2ind([h,w],y,x);
G(:,:,1) = f(:,:,1)(u);
G(:,:,2) = f(:,:,2)(u);
G(:,:,3) = f(:,:,3)(u);
H = F;
H((b-3):(b+3),(a-3):(a+3),1) = uint8(255*ones(7));
H((b-3):(b+3),(a-3):(a+3),2) = uint8(zeros(7));
H((b-3):(b+3),(a-3):(a+3),3) = uint8(255*ones(7));
ad = round(a + 9*cos(t(1,end)));
bd = round(b + 9*sin(t(1,end)));
H((bd-2):(bd+2),(ad-2):(ad+2),1) = uint8(255*ones(5));
H((bd-2):(bd+2),(ad-2):(ad+2),2) = uint8(zeros(5));
H((bd-2):(bd+2),(ad-2):(ad+2),3) = uint8(255*ones(5));
ad = round(a + 17*cos(t(1,end)));
bd = round(b + 17*sin(t(1,end)));
H((bd-1):(bd+1),(ad-1):(ad+1),1) = uint8(255*ones(3));
H((bd-1):(bd+1),(ad-1):(ad+1),2) = uint8(zeros(3));
H((bd-1):(bd+1),(ad-1):(ad+1),3) = uint8(255*ones(3));
imshow([uint8([flip(G,1);J]),H]);
title('Just press Esc to quit ;-)');

z = 0;
l = 12; % lissage

while z ~= 27
  [xg,yg,z] = ginput(1);
  if z==1
    if xg>wt
      a = round(xg-wt);
      b = round(yg);
      d = 0;
    elseif yg>(hs-hr)
      p = min(max(round(xg),1),wt);
      q = min(max(round(yg-hs+hr),1),hr);
      p = yr(q,p)-R0(p);
      q = p*exp(-(((1:wt)-xg)/(wt/l)).^2);
      q = q+p*exp(-((((1-wt):0)-xg)/(wt/l)).^2);
      q = q+p*exp(-((((1+wt):(2*wt))-xg)/(wt/l)).^2);
      R0 = R0+q;
      d = 0;
    else
      d = 2*pi*xg/wt;
    endif
    dd = min(max(round(wt*d/(2*pi)),1),wt);
    R0 = [R0((dd+1):end),R0(1:dd)];
    t = t+d;
    c = repmat(R0,[hs-hr,1]);
    x = 4*exp(4*(r+c)/h).*cos(t) + 2*a;
    y = 4*exp(4*(r+c)/h).*sin(t) + 2*b;
    x = min(max(round(x),1),w);
    y = min(max(round(y),1),h);
    u = sub2ind([h,w],y,x);
    G(:,:,1) = f(:,:,1)(u);
    G(:,:,2) = f(:,:,2)(u);
    G(:,:,3) = f(:,:,3)(u);
    H = F;
    H((b-3):(b+3),(a-3):(a+3),1) = uint8(255*ones(7));
    H((b-3):(b+3),(a-3):(a+3),2) = uint8(zeros(7));
    H((b-3):(b+3),(a-3):(a+3),3) = uint8(255*ones(7));
    ad = round(a + 9*cos(t(1,end)));
    bd = round(b + 9*sin(t(1,end)));
    H((bd-2):(bd+2),(ad-2):(ad+2),1) = uint8(255*ones(5));
    H((bd-2):(bd+2),(ad-2):(ad+2),2) = uint8(zeros(5));
    H((bd-2):(bd+2),(ad-2):(ad+2),3) = uint8(255*ones(5));
    ad = round(a + 17*cos(t(1,end)));
    bd = round(b + 17*sin(t(1,end)));
    H((bd-1):(bd+1),(ad-1):(ad+1),1) = uint8(255*ones(3));
    H((bd-1):(bd+1),(ad-1):(ad+1),2) = uint8(zeros(3));
    H((bd-1):(bd+1),(ad-1):(ad+1),3) = uint8(255*ones(3));
    J(:,:,2) = 128*double(yr<R0);
    J(:,:,2) = J(:,:,2)-imerode(J(:,:,2),ones(3))/2;
    imshow([uint8([flip(G,1);J]),H]);
    title('Just press Esc to quit ;-)');
  endif
endwhile

close all;

endfunction
